import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';

// Records actual interactions with the running application. Playwright's
// screencast is silent; exported story videos contain synthesized narration.
const base = process.env.CUTBACK_URL || 'http://127.0.0.1:4318';
await fs.mkdir('artifacts/recordings', { recursive: true });
const initial = await fetch(base + '/api/state').then((r) => r.json());
if (!initial.latest) throw new Error('Wait for the first cut to finish before recording.');
const original = { orbitBase: 7900, orbitAdapter: 4900, adapterIncluded: true, formaBase: 11900 };
if (Object.entries(original).some(([key, value]) => initial.latest.evidence[key] !== value)) {
  const response = await fetch(base + '/api/revisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: initial.latest.revision,
      evidence: original,
      sourceNote: 'Restore the original synthetic product sheets before the recording.',
    }),
  });
  const run = await response.json();
  if (!response.ok) throw new Error(run.error);
  let status;
  for (let n = 0; n < 180; n++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    status = await fetch(base + '/api/runs/' + run.id).then((r) => r.json());
    if (status.status !== 'running') break;
  }
  if (status.status !== 'complete')
    throw new Error(status.error || 'The original cut did not finish.');
}
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: 'artifacts/recordings', size: { width: 1440, height: 1000 } },
});
const page = await context.newPage();
const video = page.video();
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.scene-card').filter({ hasText: 'The verdict' }).click();
  await page.locator('.player-frame video').evaluate(async (v) => {
    v.muted = true;
    await v.play();
  });
  await page.waitForTimeout(3500);
  await page.locator('.player-frame video').evaluate((v) => v.pause());
  await page.getByRole('button', { name: 'Load the correction' }).click();
  await page.getByText('2 scenes will be reconsidered').waitFor();
  await page.waitForTimeout(3000);
  await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
  await page.waitForTimeout(4500);
  await page.getByRole('button', { name: 'Inspect the Cypher query' }).click();
  await page.waitForTimeout(3500);
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild affected scenes' }).click();
  await page.waitForTimeout(2000);
  await page.locator('.inspector').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('heading', { name: 'Your new cut is ready' }).waitFor({ timeout: 180000 });
  await page.waitForTimeout(2500);
  await page.locator('.inspector').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.locator('.scene-card').filter({ hasText: 'The verdict' }).click();
  await page.locator('.player-frame video').evaluate(async (v) => {
    v.muted = true;
    await v.play();
  });
  await page.waitForTimeout(3500);
  await page.locator('.player-frame video').evaluate((v) => v.pause());
  await page.getByRole('button', { name: 'Compare cuts' }).click();
  await page
    .locator('.compare-grid video')
    .first()
    .evaluate(
      (v) =>
        new Promise((resolve) => {
          if (v.readyState >= 1) resolve();
          else v.addEventListener('loadedmetadata', resolve, { once: true });
        }),
    );
  await page.waitForTimeout(6500);
  await page.getByRole('button', { name: 'Close comparison' }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.waitForTimeout(3000);
} finally {
  await context.close();
  try {
    // Closing the context flushes the video; keep the browser connection alive
    // until Playwright has copied the artifact to its requested destination.
    await video.saveAs('artifacts/cutback-walkthrough.webm');
  } finally {
    await browser.close();
  }
}
await promisify(execFile)(
  ffmpeg,
  [
    '-y',
    '-i',
    'artifacts/cutback-walkthrough.webm',
    '-c:v',
    'libx264',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    'artifacts/cutback-walkthrough.mp4',
  ],
  { timeout: 120000, maxBuffer: 5e6 },
);
const state = await fetch(base + '/api/state').then((r) => r.json());
for (const [name, version] of [
  ['original-cut', state.versions[state.versions.length - 1]],
  ['revised-cut', state.latest],
]) {
  const response = await fetch(base + version.videoUrl);
  await fs.writeFile('artifacts/' + name + '.mp4', Buffer.from(await response.arrayBuffer()));
}
console.log('Saved artifacts/cutback-walkthrough.mp4 (silent real UI recording).');
console.log('Saved original-cut.mp4 and revised-cut.mp4 (narrated rendered films).');
console.log('Recorded editorial mode: ' + state.latest.mode);
