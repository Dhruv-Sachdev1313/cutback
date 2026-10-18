import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import sharp from 'sharp';
import type { Edit, ImportedScene, UploadProject } from '../../shared/upload.js';
import { uploadConfig, urlFor, fileFor } from './config.js';
const execute = promisify(execFile);
const ffmpeg = ffmpegStatic!;
const ffprobe = ffprobeStatic.path;
async function ff(args: string[], timeout = 180000) {
  return execute(ffmpeg, ['-nostdin', '-hide_banner', '-y', ...args], { timeout, maxBuffer: 8e6 });
}
export async function probe(file: string) {
  const { stdout } = await execute(
    ffprobe,
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
    { timeout: 20000, maxBuffer: 2e6 },
  );
  const data = JSON.parse(stdout);
  const video = data.streams.find((s: any) => s.codec_type === 'video');
  const duration = Number(data.format.duration);
  if (!video || !Number.isFinite(duration) || duration < 2 || duration > uploadConfig.maxSeconds)
    throw new Error('Upload a video between 2 seconds and 2 minutes long.');
  if (video.width > 4096 || video.height > 4096)
    throw new Error('Upload a video with dimensions at or below 4096 pixels.');
  return {
    duration,
    width: Number(video.width),
    height: Number(video.height),
    hasAudio: data.streams.some((s: any) => s.codec_type === 'audio'),
  };
}
export function sceneBoundaries(duration: number, cuts: number[]) {
  const result = [0];
  for (const cut of cuts.sort((a, b) => a - b))
    if (cut - result.at(-1)! >= 3 && duration - cut >= 2) result.push(cut);
  if (result.length === 1) for (let t = 12; t < duration - 2; t += 12) result.push(t);
  if (result.length > 12) {
    const step = Math.ceil(result.length / 12);
    return result.filter((_, i) => i % step === 0).concat(duration);
  }
  return result.concat(duration);
}
export async function extract(
  p: UploadProject,
  log: (tool: string, detail: string) => Promise<void>,
) {
  const dir = path.join(uploadConfig.media, p.id);
  const input = fileFor(p.originalUrl);
  let segments: { start: number; end: number; text: string }[] = [];
  if (p.hasAudio) {
    await log(
      'transcribe_local',
      'Extracting audio and transcribing on this computer. No OpenAI audio charge.',
    );
    await ff(['-i', input, '-vn', '-ar', '16000', '-ac', '1', path.join(dir, 'audio.wav')]);
    const python = path.resolve('.venv/bin/python');
    try {
      await fs.access(python);
    } catch {
      throw new Error(
        'Local transcription is not installed. Run npm run upload:setup-transcription.',
      );
    }
    await execute(
      python,
      [
        path.resolve('scripts/transcribe-local.py'),
        path.join(dir, 'audio.wav'),
        path.join(dir, 'transcript.json'),
      ],
      { cwd: process.cwd(), timeout: 600000, maxBuffer: 4e6 },
    );
    const data = JSON.parse(await fs.readFile(path.join(dir, 'transcript.json'), 'utf8'));
    segments = data.segments;
    p.evidence = segments
      .filter((s) => s.text.trim())
      .map((s, i) => ({
        id: 'speech' + i,
        kind: 'speech',
        text: s.text,
        start: s.start,
        end: s.end,
        sourceName: p.filename + ' · local transcript',
      }));
    await log('transcribe_local', `Extracted ${segments.length} timestamped speech passages.`);
  } else {
    p.evidence = [];
    await log(
      'inspect_audio',
      'This video has no audio track. Analysis will use frames and any supplied notes.',
    );
  }
  await log('detect_scenes', 'Finding visual cuts and extracting frame evidence.');
  const { stderr } = await ff([
    '-i',
    input,
    '-vf',
    "scale=320:-1,select='gt(scene,0.22)',showinfo",
    '-an',
    '-f',
    'null',
    '-',
  ]);
  const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  const boundaries = sceneBoundaries(p.duration, cuts);
  // Snap a cut to a nearby speech ending to avoid splitting a spoken sentence.
  for (let i = 1; i < boundaries.length - 1; i++) {
    const nearby = segments
      .filter(
        (s) =>
          Math.abs(s.end - boundaries[i]) < 1.2 &&
          s.end > boundaries[i - 1] + 1 &&
          s.end < boundaries[i + 1] - 1,
      )
      .sort((a, b) => Math.abs(a.end - boundaries[i]) - Math.abs(b.end - boundaries[i]))[0];
    if (nearby) boundaries[i] = nearby.end;
  }
  p.scenes = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i],
      end = boundaries[i + 1];
    const at = start + Math.min(1.4, (end - start) / 2);
    const image = path.join(dir, `frame-${i}.jpg`);
    await ff([
      '-ss',
      String(at),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      'scale=768:-2',
      '-q:v',
      '3',
      image,
    ]);
    const frameUrl = urlFor(`${p.id}/frame-${i}.jpg`);
    const id = 's' + i;
    const text = segments
      .filter((s) => s.start < end && s.end > start)
      .map((s) => s.text)
      .join(' ');
    p.scenes.push({ id, title: `Scene ${i + 1}`, start, end, transcript: text, frameUrl });
    p.evidence.push({
      id: 'frame' + i,
      kind: 'frame',
      text: 'Visual evidence from the uploaded video. Review the actual frame.',
      start: at,
      end: at,
      sourceName: p.filename,
      imageUrl: frameUrl,
    });
  }
  if (p.sourceText.trim())
    p.evidence.push({
      id: 'document0',
      kind: 'document',
      text: p.sourceText,
      start: 0,
      end: 0,
      sourceName: 'Source notes supplied with upload',
    });
  await log(
    'detect_scenes',
    `${p.scenes.length} video segments and ${p.evidence.length} evidence items ready for analysis.`,
  );
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
function lines(text: string, width = 57) {
  const result: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).length > width && line) {
      result.push(line);
      line = '';
    }
    line += (line ? ' ' : '') + word;
  }
  if (line) result.push(line);
  return result;
}
async function correctedCard(edit: Edit, dir: string) {
  await fs.mkdir(dir, { recursive: true });
  const script = path.join(dir, 'narration.txt');
  await fs.writeFile(script, edit.narration);
  const audio = path.join(dir, process.platform === 'darwin' ? 'voice.aiff' : 'voice.wav');
  if (process.platform === 'darwin')
    await execute(
      'say',
      ['-v', process.env.LOCAL_VOICE || 'Samantha', '-r', '165', '-f', script, '-o', audio],
      { timeout: 60000 },
    );
  else await execute('espeak-ng', ['-s', '160', '-f', script, '-w', audio], { timeout: 60000 });
  const { stdout } = await execute(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    audio,
  ]);
  const duration = Math.ceil((Number(stdout) + 0.5) * 24) / 24;
  const title = lines(edit.title, 42).slice(0, 2);
  const body = lines(edit.narration, 72);
  const pages = [];
  const pageCount = Math.ceil(body.length / 6);
  for (let i = 0; i < pageCount; i++) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#eee9df"/><rect x="0" y="0" width="14" height="720" fill="#a94c31"/><text x="72" y="76" font-family="Arial" font-size="20" fill="#a94c31" letter-spacing="4">CUTBACK / CORRECTION</text>${title.map((l, j) => `<text x="72" y="${153 + j * 58}" font-family="Arial" font-weight="bold" font-size="46" fill="#202923">${escape(l)}</text>`).join('')}${body
      .slice(i * 6, i * 6 + 6)
      .map(
        (l, j) =>
          `<text x="72" y="${307 + j * 45}" font-family="Arial" font-size="29" fill="#303b33">${escape(l)}</text>`,
      )
      .join(
        '',
      )}<line x1="72" x2="1208" y1="640" y2="640" stroke="#bcb6aa"/><text x="72" y="683" font-family="Arial" font-size="18" fill="#647067">Revised from source evidence · synthetic narration</text><text x="1145" y="683" font-family="Arial" font-size="18" fill="#647067">${i + 1}/${pageCount}</text></svg>`;
    const name = `card-${i}.png`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(dir, name));
    pages.push(`file '${name}'\nduration ${(duration / pageCount).toFixed(6)}`);
  }
  pages.push(`file 'card-${pageCount - 1}.png'`);
  await fs.writeFile(path.join(dir, 'frames.txt'), pages.join('\n'));
  const output = path.join(dir, 'clip.mp4');
  await ff([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(dir, 'frames.txt'),
    '-i',
    audio,
    '-vf',
    'fps=24,format=yuv420p',
    '-af',
    'apad',
    '-t',
    String(duration),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    output,
  ]);
  return { file: output, duration, text: edit.narration };
}
async function originalClip(p: UploadProject, s: ImportedScene) {
  const dir = path.join(uploadConfig.media, p.id, 'original-clips');
  await fs.mkdir(dir, { recursive: true });
  const output = path.join(dir, s.id + '.mp4');
  try {
    await fs.access(output);
  } catch {
    const inputs = ['-ss', String(s.start), '-i', fileFor(p.originalUrl)];
    if (!p.hasAudio) inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    await ff([
      ...inputs,
      '-t',
      String(s.end - s.start),
      '-vf',
      'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p',
      '-map',
      '0:v:0',
      '-map',
      p.hasAudio ? '0:a:0' : '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '21',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      output,
    ]);
  }
  return { file: output, duration: s.end - s.start, text: s.transcript };
}
function stamp(n: number) {
  const ms = Math.round(n * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export async function renderImported(
  p: UploadProject,
  id: string,
  log: (tool: string, detail: string) => Promise<void>,
) {
  const dir = path.join(uploadConfig.media, p.id, id);
  await fs.mkdir(dir, { recursive: true });
  const clips: { file: string; duration: number; text: string }[] = [];
  for (const scene of p.scenes) {
    const edit = p.edits!.find((e) => e.sceneId === scene.id);
    await log(
      'render_segment',
      `${scene.title}: ${edit ? 'rendering a correction card and new narration' : 'preserving uploaded footage and audio'}.`,
    );
    clips.push(
      edit ? await correctedCard(edit, path.join(dir, scene.id)) : await originalClip(p, scene),
    );
  }
  await fs.writeFile(
    path.join(dir, 'concat.txt'),
    clips.map((c) => `file '${path.relative(dir, c.file)}'`).join('\n'),
  );
  const output = path.join(dir, 'revised.mp4');
  await ff([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(dir, 'concat.txt'),
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    output,
  ]);
  const captions: string[] = [];
  let offset = 0,
    seq = 0;
  for (const clip of clips) {
    const parts = lines(clip.text, 82);
    for (let i = 0; i < parts.length; i++)
      captions.push(
        `${++seq}\n${stamp(offset + (i * clip.duration) / parts.length)} --> ${stamp(offset + ((i + 1) * clip.duration) / parts.length)}\n${parts[i]}\n`,
      );
    offset += clip.duration;
  }
  await fs.writeFile(path.join(dir, 'captions.srt'), captions.join('\n'));
  return {
    videoUrl: urlFor(`${p.id}/${id}/revised.mp4`),
    captionsUrl: urlFor(`${p.id}/${id}/captions.srt`),
  };
}
