import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.CUTBACK_URL || 'http://127.0.0.1:4318';
const destination = 'docs/article-assets';
await fs.mkdir(destination, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  const state = await fetch(base + '/api/state').then((r) => r.json());
  if (!state.latest || state.latest.calculation.winner !== 'forma') {
    throw new Error('Apply the standard adapter correction before capturing article images.');
  }
  await page.locator('.scene-card').filter({ hasText: 'The verdict' }).click();
  await page.locator('.player-frame video').evaluate(async (video) => {
    video.muted = true;
    await video.play();
  });
  await page.waitForTimeout(700);
  await page.locator('.player-frame video').evaluate((video) => video.pause());
  await page.screenshot({ path: destination + '/studio.png', fullPage: true });

  // Preview a change to the same boolean fact. The graph paths are independent
  // of the direction of that change. No source revision is submitted here.
  await page.getByRole('switch', { name: 'Adapter included in speaker price' }).click();
  await page.getByText('2 scenes will be reconsidered').waitFor();
  await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect the Cypher query' }).click();
  await page.locator('.graph-section').screenshot({ path: destination + '/dependency-map.png' });
  await page.getByRole('switch', { name: 'Adapter included in speaker price' }).click();
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();

  await page.getByRole('button', { name: 'Compare cuts' }).click();
  await page.getByRole('button', { name: 'Play both cuts' }).click();
  const versions = [state.versions.at(-1), state.latest];
  for (let i = 0; i < versions.length; i++) {
    const offset =
      versions[i].scenes.slice(0, 2).reduce((sum, scene) => sum + scene.duration, 0) + 0.5;
    await page
      .locator('.compare-grid video')
      .nth(i)
      .evaluate((video, time) => {
        video.muted = true;
        video.currentTime = time;
      }, offset);
  }
  await page.waitForTimeout(700);
  await page
    .locator('.compare-grid video')
    .evaluateAll((videos) => videos.forEach((video) => video.pause()));
  await page.locator('.compare-modal').screenshot({ path: destination + '/compare-verdicts.png' });
  console.log('Saved actual studio, dependency map, and MP4 comparison screenshots.');
  console.log('Editorial mode: ' + state.latest.mode);
} finally {
  await browser.close();
}
