import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { UploadProject, Edit, ImportedClaim } from '../../shared/upload.js';
import type { Evidence, Scene } from '../../shared/types.js';
import { ORIGINAL, buildScenes, calculate, evidenceSchema } from '../story.js';
import { sceneSvg, esc } from '../visuals.js';

// Editable layout for the bundled, authored film. Recognition requires the actual
// media fingerprint, never a filename or an invented analysis of other footage.
export const SPEAKER_SHA256 = '1611c3eb1775fde6ad2401af644d426672b8f100654783f5ea9e36f71c037b04';
export const SPEAKER_BOUNDARIES = [0, 166 / 24, 487 / 24, 618 / 24];
export const SPEAKER_LAYOUTS = ['opening', 'cost', 'verdict', 'outro'] as const;
export async function detectRenderProfile(file: string) {
  return createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex') === SPEAKER_SHA256
    ? ('speaker-study-v1' as const)
    : undefined;
}
export const naturalText = (text: string) =>
  text
    .replace(/^\s*(?:correction(?:\s+card)?|updated?\s+(?:version|fact|scene))\s*[:—–-]\s*/i, '')
    .trim();

// Only used to reuse an already reviewed analysis of this exact authored film.
// Old exports live in their original project; the aligned edition is a new graph.
export function alignSpeakerClaims(claims: ImportedClaim[]): ImportedClaim[] {
  return claims.map((c) => {
    let id = 's1';
    if (
      /fictional|sound quality|limits? (?:its |the )?comparison|comparison (?:covers|is limited)/i.test(
        c.text,
      )
    )
      id = 's3';
    else if (/recommend|lower.cost pick|costs?.{0,20}less|cheaper|saving/i.test(c.text)) id = 's2';
    return { ...c, sceneIds: [id] };
  });
}
const amount = '([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)';
const currency = '(?:USD\\s*|\\$)';
function dollars(text: string, pattern: string) {
  const match = text.match(new RegExp(pattern, 'i'));
  return match ? Math.round(Number(match[1].replaceAll(',', '')) * 100) : undefined;
}
export function speakerEvidence(p: UploadProject): Evidence {
  if (p.renderProfile !== 'speaker-study-v1' || !p.correction)
    throw new Error('An editable speaker film and a source correction are required.');
  const original = p.facts.find((f) => f.id === p.correction!.factId)?.text || '';
  const text = p.correction.text,
    source = p.correction.source;
  const result = { ...ORIGINAL };
  if (/adapter/i.test(original)) {
    if (/not included|excluded|sold separately|bought separately|purchased separately/i.test(text))
      result.adapterIncluded = false;
    else if (/(?:is |now )?included/i.test(text)) result.adapterIncluded = true;
    else throw new Error('State whether the adapter is included or sold separately.');
    const pattern = `(?:separately\\s+(?:for\\s+)?|adapter\\s+(?:costs?|price(?:\\s+is)?)\\s*)${currency}${amount}`;
    const price = dollars(text, pattern) ?? dollars(source, pattern);
    if (price !== undefined) result.orbitAdapter = price;
    else if (!result.adapterIncluded)
      throw new Error(
        'Include the separate adapter price in the correction, for example “bought separately for $49”.',
      );
  } else if (/forma/i.test(original)) {
    const price = dollars(text, `(?:Forma(?:\\s+One)?)[^$\\n]{0,60}${currency}${amount}`);
    if (price === undefined)
      throw new Error('Include Forma’s complete price in the corrected fact.');
    result.formaBase = price;
  } else if (/orbit/i.test(original)) {
    const price = dollars(text, `(?:Orbit(?:\\s*Mini)?)[^$\\n]{0,60}${currency}${amount}`);
    if (price === undefined)
      throw new Error('Include Orbit’s speaker price in the corrected fact.');
    result.orbitBase = price;
  } else throw new Error('This editable layout supports speaker-price and adapter changes.');
  return evidenceSchema.parse(result);
}
export function compilePresentation(p: UploadProject, edits: Edit[]): Edit[] {
  if (p.renderProfile !== 'speaker-study-v1')
    return edits.map((e) => ({
      ...e,
      title: naturalText(e.title),
      narration: naturalText(e.narration),
    }));
  const evidence = speakerEvidence(p);
  const scripts = buildScenes(evidence, calculate(evidence));
  return edits.map((edit) => {
    const layout = p.scenes.find((s) => s.id === edit.sceneId)?.layout;
    const script = scripts.find((s) => s.id === layout);
    if (!layout || !script) throw new Error('The scene does not have an editable layout.');
    return {
      ...edit,
      title: script.headline.replaceAll('\n', ' '),
      narration: script.narration,
      visual: { layout, evidence },
    };
  });
}
export function captionPhrases(text: string): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length > 88) {
      out.push(line);
      line = '';
    }
    line += (line ? ' ' : '') + word;
    if (/[.!?]$/.test(word) && line.length > 35) {
      out.push(line);
      line = '';
    }
  }
  if (line) out.push(line);
  return out;
}
export function presentationSvg(edit: Edit, caption: string): string {
  if (edit.visual) {
    const { evidence, layout } = edit.visual;
    const calculation = calculate(evidence);
    const scene = buildScenes(evidence, calculation).find((s) => s.id === layout)!;
    return sceneSvg(
      { ...scene, narration: edit.narration } as Scene,
      evidence,
      calculation,
      caption,
    );
  }
  // General uploads receive an unlabelled editorial scene, rather than an audit
  // notice. Exact visual reconstruction is available for the editable film above.
  const words = naturalText(edit.title).split(' ');
  const title: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).length > 30) {
      title.push(line);
      line = '';
    }
    line += (line ? ' ' : '') + word;
  }
  if (line) title.push(line);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#10201d"/><stop offset="1" stop-color="#293c35"/></linearGradient></defs><rect width="1280" height="720" fill="url(#bg)"/><circle cx="1120" cy="290" r="280" fill="none" stroke="#68816d" opacity=".3"/><circle cx="1120" cy="290" r="220" fill="none" stroke="#68816d" opacity=".3"/><rect x="80" y="125" width="75" height="6" fill="#d78560"/>${title
    .slice(0, 4)
    .map(
      (t, i) =>
        `<text x="80" y="${235 + i * 70}" fill="#f5f2e9" font-family="Arial" font-size="57" font-weight="bold">${esc(t)}</text>`,
    )
    .join(
      '',
    )}<rect x="65" y="590" width="1150" height="85" rx="8" fill="#08110e" opacity=".9"/>${captionPhrases(
    caption,
  )
    .map(
      (t, i) =>
        `<text x="640" y="${625 + i * 31}" text-anchor="middle" fill="#f5f2e9" font-family="Arial" font-size="23">${esc(t)}</text>`,
    )
    .join('')}</svg>`;
}
