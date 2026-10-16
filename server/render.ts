import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import OpenAI from 'openai';
import type { Calculation, Evidence, Scene } from '../shared/types.js';
import { MEDIA_DIR } from './config.js';
import { sceneSvg } from './visuals.js';

const exec = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || ffmpegStatic!;
const mediaUrl = (file: string) => '/media/' + path.relative(MEDIA_DIR,file).split(path.sep).join('/');
export const fileForUrl = (url: string) => path.join(MEDIA_DIR, url.replace(/^\/media\//,''));
async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }
export function captionChunks(text: string): string[] {
  const chunks: string[] = []; let current = '';
  for (const word of text.split(/\s+/)) {
    if (current.length + word.length > 94) { chunks.push(current); current = ''; }
    current += (current ? ' ' : '') + word;
    if (/[.!?]$/.test(word) && current.length >= 42) { chunks.push(current); current = ''; }
  }
  if (current) chunks.push(current);
  return chunks;
}
export function wavDuration(buffer: Buffer): number {
  let bytesPerSecond = 0; let dataLength = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const type = buffer.toString('ascii', offset, offset + 4); const length = buffer.readUInt32LE(offset+4);
    if (type === 'fmt ') bytesPerSecond = buffer.readUInt32LE(offset+16);
    if (type === 'data') { dataLength = Math.min(length,buffer.length-offset-8); break; }
    offset += 8 + length + (length % 2);
  }
  if (!bytesPerSecond || !dataLength) throw new Error('The narration renderer did not produce a valid WAV file.');
  return dataLength / bytesPerSecond;
}
async function narrate(text: string, dir: string) {
  const raw = path.join(dir, process.platform === 'darwin' ? 'speech.aiff' : 'speech.wav');
  const output = path.join(dir, 'narration.wav');
  if (process.env.TTS_PROVIDER === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI narration requires OPENAI_API_KEY.');
    const response = await new OpenAI({ timeout: 60000, maxRetries: 1 }).audio.speech.create({
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: (process.env.OPENAI_TTS_VOICE || 'coral') as 'coral', input: text, response_format: 'wav',
    });
    await fs.writeFile(raw, Buffer.from(await response.arrayBuffer()));
  } else if (process.platform === 'darwin') {
    const script = path.join(dir,'script.txt'); await fs.writeFile(script,text);
    await exec('say', ['-v', process.env.LOCAL_VOICE || 'Samantha', '-r', '165', '-f', script, '-o', raw], { timeout: 60000 });
  } else {
    const script = path.join(dir,'script.txt'); await fs.writeFile(script,text);
    await exec('espeak-ng', ['-v','en-us','-s','158','-f',script,'-w',raw], { timeout: 60000 }).catch(() => { throw new Error('Install espeak-ng for local narration, or set TTS_PROVIDER=openai.'); });
  }
  await exec(ffmpeg, ['-y','-i',raw,'-ar','24000','-ac','1','-c:a','pcm_s16le',output], { timeout: 30000, maxBuffer: 3e6 });
  return { file: output, duration: wavDuration(await fs.readFile(output)) };
}
export async function renderScene(scene: Scene, e: Evidence, c: Calculation): Promise<Scene> {
  const visual = scene.id === 'cost' ? { e,c } : scene.id === 'verdict' ? {c} : {};
  const hash = createHash('sha256').update(JSON.stringify({ renderer: 3, id:scene.id, headline:scene.headline, narration:scene.narration, visual, tts:process.env.TTS_PROVIDER || 'local', voice:process.env.LOCAL_VOICE || process.env.OPENAI_TTS_VOICE || 'default' })).digest('hex').slice(0,24);
  const dir = path.join(MEDIA_DIR,'scenes',hash); await fs.mkdir(dir,{recursive:true});
  const video = path.join(dir,'scene.mp4'); const poster = path.join(dir,'poster.png'); const metadata = path.join(dir,'metadata.json');
  if (await exists(metadata) && await exists(video) && await exists(poster)) {
    const cached = JSON.parse(await fs.readFile(metadata,'utf8')) as {duration:number};
    return {...scene, footageHash:hash, duration:cached.duration, videoUrl:mediaUrl(video), posterUrl:mediaUrl(poster), audioUrl:mediaUrl(path.join(dir,'narration.wav')), rebuilt:false};
  }
  await sharp(Buffer.from(sceneSvg(scene,e,c))).png().toFile(poster);
  const narration = await narrate(scene.narration, dir); const duration = Math.ceil((narration.duration + 0.5)*24)/24;
  const chunks = captionChunks(scene.narration); const totalLength = chunks.reduce((sum,s)=>sum+s.length,0);
  const entries: string[] = []; let lastFile = '';
  for (let index=0;index<chunks.length;index++) {
    const file = 'caption-' + index + '.png'; lastFile = file;
    await sharp(Buffer.from(sceneSvg(scene,e,c,chunks[index]))).png().toFile(path.join(dir,file));
    const len = duration * chunks[index].length / totalLength;
    entries.push("file '" + file + "'\nduration " + len.toFixed(6));
  }
  entries.push("file '" + lastFile + "'");
  await fs.writeFile(path.join(dir,'frames.txt'), entries.join('\n'));
  await exec(ffmpeg, ['-y','-f','concat','-safe','0','-i',path.join(dir,'frames.txt'),'-i',narration.file,
    '-vf','fps=24,format=yuv420p,fade=t=in:st=0:d=0.25,fade=t=out:st='+(duration-.2).toFixed(3)+':d=0.2',
    '-af','apad','-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-b:a','128k','-ar','24000','-ac','1','-movflags','+faststart',video],
    { timeout: 120000, maxBuffer: 8e6 });
  await fs.writeFile(metadata,JSON.stringify({duration,hash}));
  return {...scene, duration, footageHash:hash, videoUrl:mediaUrl(video), posterUrl:mediaUrl(poster), audioUrl:mediaUrl(narration.file), rebuilt:true};
}
function timestamp(seconds: number) {
  const ms = Math.round(seconds*1000);
  return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(n=>String(n).padStart(2,'0')).join(':') + ',' + String(ms%1000).padStart(3,'0');
}
export async function assembleVideo(id: string, scenes: Scene[]) {
  const dir = path.join(MEDIA_DIR,'versions',id); await fs.mkdir(dir,{recursive:true});
  const video = path.join(dir,'cutback.mp4'); const captions = path.join(dir,'captions.srt');
  const list = scenes.map(s=>"file '../../scenes/"+s.footageHash+"/scene.mp4'").join('\n');
  await fs.writeFile(path.join(dir,'concat.txt'),list);
  await exec(ffmpeg,['-y','-f','concat','-safe','0','-i',path.join(dir,'concat.txt'),'-c','copy','-movflags','+faststart',video],{timeout:60000,maxBuffer:4e6});
  let offset=0; let seq=0; const cues:string[]=[];
  for (const scene of scenes) {
    const chunks=captionChunks(scene.narration); const length=chunks.reduce((n,s)=>n+s.length,0); let cursor=offset;
    for (const chunk of chunks) { const end=cursor+scene.duration*chunk.length/length; cues.push(`${++seq}\n${timestamp(cursor)} --> ${timestamp(end)}\n${chunk}\n`); cursor=end; }
    offset+=scene.duration;
  }
  await fs.writeFile(captions,cues.join('\n'));
  return { videoUrl:mediaUrl(video),captionsUrl:mediaUrl(captions),duration:offset };
}
