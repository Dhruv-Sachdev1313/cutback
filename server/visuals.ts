import type { Calculation, Evidence, Scene } from '../shared/types.js';
import { money } from './story.js';
export const esc = (text: string) => text.replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[ch]!));
function lines(text: string, x: number, y: number, size: number, color = '#f8f7f2', weight = 600) {
  return text.split('\n').map((line, i) => `<text x="${x}" y="${y+i*size*1.12}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="-2.3">${esc(line)}</text>`).join('');
}
export function speaker(x: number, y: number, scale: number, variant: 'orbit' | 'forma') {
  const orbit = variant === 'orbit';
  const color = orbit ? '#cb6b42' : '#9bada3';
  const top = orbit ? '#ed9a70' : '#c8d5cb';
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <ellipse cx="108" cy="278" rx="126" ry="28" fill="#000" opacity=".3" filter="url(#blur)"/>
    <rect x="0" y="0" width="216" height="260" rx="${orbit?74:30}" fill="${color}"/>
    <rect x="0" y="0" width="216" height="260" rx="${orbit?74:30}" fill="url(#bodyShade)"/>
    <rect x="14" y="40" width="188" height="200" rx="${orbit?64:20}" fill="url(#grille)" opacity=".6"/>
    <ellipse cx="108" cy="30" rx="${orbit?89:88}" ry="${orbit?30:20}" fill="${top}"/>
    <ellipse cx="108" cy="27" rx="${orbit?70:73}" ry="${orbit?20:12}" fill="#000" opacity=".12"/>
    <circle cx="108" cy="27" r="3.6" fill="#fff" opacity=".75"/>
    <path d="M82 27 h7 M128 27 h7 m-3.5 -3.5 v7" stroke="#fff" stroke-width="2" opacity=".65"/>
    <rect x="82" y="214" width="52" height="16" rx="8" fill="#000" opacity=".17"/>
    <text x="108" y="225" text-anchor="middle" font-family="Arial" font-size="8" letter-spacing="2" fill="#fff" opacity=".9">${orbit?'ORBIT':'FORMA'}</text>
  </g>`;
}
export function sceneSvg(scene: Scene, e: Evidence, c: Calculation, caption = '') {
  const max = Math.max(c.orbitTotal, c.formaTotal, 1);
  let content = '';
  if (scene.id === 'opening') content = lines(scene.headline, 78, 265, 69) + `<text x="82" y="445" fill="#95a6a0" font-family="Arial" font-size="19">A comparison that follows the evidence.</text>` + speaker(755,235,1.05,'orbit') + speaker(1005,275,.82,'forma');
  if (scene.id === 'cost') content = lines(scene.headline, 78, 230, 62) + `<text x="82" y="414" fill="#9eaaa5" font-family="Arial" font-size="19">${e.adapterIncluded?'Everything you need. Included.':'The adapter changes the equation.'}</text><text x="82" y="449" fill="#d8b59e" font-family="Arial" font-size="18">Orbit: ${esc(money(e.orbitBase))}${e.adapterIncluded?'':' + '+esc(money(e.orbitAdapter))+' adapter'}</text>
    <text x="680" y="218" fill="#c5cec9" font-family="Arial" font-size="19">ORBIT MINI</text><text x="1180" y="218" text-anchor="end" fill="#fff" font-family="Arial" font-size="34" font-weight="600">${esc(money(c.orbitTotal))}</text>
    <rect x="680" y="246" width="500" height="48" rx="9" fill="#263432"/><rect x="680" y="246" width="${Math.max(2,500*c.orbitTotal/max)}" height="48" rx="9" fill="#d78560"/>
    <text x="680" y="369" fill="#c5cec9" font-family="Arial" font-size="19">FORMA ONE</text><text x="1180" y="369" text-anchor="end" fill="#fff" font-family="Arial" font-size="34" font-weight="600">${esc(money(c.formaTotal))}</text>
    <rect x="680" y="397" width="500" height="48" rx="9" fill="#263432"/><rect x="680" y="397" width="${Math.max(2,500*c.formaTotal/max)}" height="48" rx="9" fill="#b1c9b8"/>
    <text x="680" y="492" fill="#738c81" font-family="Arial" font-size="15">Complete upfront cost · lower is better</text>`;
  if (scene.id === 'verdict') content = lines(scene.headline, 78, 259, 65) + `<rect x="82" y="418" width="${c.winner==='tie'?345:330}" height="49" rx="24.5" fill="#c6dfc5"/><text x="105" y="450" fill="#163329" font-family="Arial" font-size="20" font-weight="600">${esc(scene.subline)}</text>` + (c.winner === 'tie' ? speaker(790,255,.85,'orbit')+speaker(1005,285,.72,'forma') : speaker(880,202,1.15,c.winner));
  if (scene.id === 'outro') content = `<circle cx="1040" cy="352" r="190" fill="none" stroke="#30413a" stroke-width="1"/><circle cx="1040" cy="352" r="140" fill="none" stroke="#30413a" stroke-width="1"/><circle cx="1040" cy="352" r="90" fill="none" stroke="#30413a" stroke-width="1"/><circle cx="1040" cy="352" r="15" fill="#d78560"/>` + lines(scene.headline,78,278,77) + `<text x="82" y="480" fill="#a8b7ac" font-family="Arial" font-size="20">Every conclusion. Connected to its source.</text>`;
  const words = caption.split(' '); const mid = caption.length > 90 ? Math.ceil(words.length/2) : words.length;
  const capLines = [words.slice(0,mid).join(' '),words.slice(mid).join(' ')].filter(Boolean);
  const captions = caption ? `<rect x="72" y="${capLines.length>1?585:610}" width="1136" height="${capLines.length>1?87:58}" rx="12" fill="#08110e" opacity=".91"/>` + capLines.map((s,i)=>`<text x="640" y="${capLines.length>1?619+i*30:646}" text-anchor="middle" fill="#f4f3eb" font-family="Arial" font-size="23">${esc(s)}</text>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#10201d"/><stop offset="1" stop-color="#1c2926"/></linearGradient><linearGradient id="bodyShade"><stop stop-color="#000" stop-opacity=".22"/><stop offset=".38" stop-color="#fff" stop-opacity=".12"/><stop offset=".65" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient><pattern id="grille" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#0e211b" opacity=".7"/></pattern><filter id="blur"><feGaussianBlur stdDeviation="9"/></filter></defs>
    <rect width="1280" height="720" fill="url(#bg)"/><path d="M0 575 L1280 575" stroke="#334039" stroke-width="1"/>
    <path d="M82 65 l14 -22 h16 l-14 22z M100 65 l14 -22 h16 l-14 22z" fill="#d78560"/>
    <text x="147" y="62" fill="#e9e9df" font-family="Arial" font-size="20" font-weight="700" letter-spacing="4">CUTBACK</text>
    <text x="1195" y="60" text-anchor="end" fill="#8b9f94" font-family="Arial" font-size="13" letter-spacing="3">FIELD NOTES / 001</text>
    <text x="82" y="141" fill="#cf9677" font-family="Arial" font-size="13" letter-spacing="3">${esc(scene.id==='verdict'?'THE VERDICT':scene.subline)}</text>
    ${content}${captions}
    <text x="82" y="696" fill="#71867b" font-family="Arial" font-size="11" letter-spacing="1">SYNTHETIC PRODUCT STUDY · UPFRONT COST ONLY</text><text x="1195" y="696" text-anchor="end" fill="#71867b" font-family="Arial" font-size="11">0${scene.order+1} / 04</text>
  </svg>`;
}
