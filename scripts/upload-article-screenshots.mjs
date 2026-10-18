import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import ffprobe from 'ffprobe-static';

const base = process.env.CUTBACK_URL || 'http://127.0.0.1:4328';
const dbBrowser = process.env.FALKORDB_BROWSER_URL || 'http://127.0.0.1:6398';
const destination = 'docs/article-assets';
const before = await fetch(base + '/api/status').then((r) => r.json());
const projects = await fetch(base + '/api/projects').then((r) => r.json());
let project;
for (const candidate of projects) {
  if (process.env.CUTBACK_PROJECT_ID && candidate.id !== process.env.CUTBACK_PROJECT_ID) continue;
  if (candidate.status !== 'complete') continue;
  const p = await fetch(base + '/api/projects/' + candidate.id).then((r) => r.json());
  if (p.renderProfile && p.revisions.at(-1)?.presentation === 'integrated') {
    project = p;
    break;
  }
}
assert.ok(project, 'Complete an integrated speaker-film export before capturing screenshots.');
const revision = project.revisions.at(-1);
const graph = 'cutback_import_' + project.id.replaceAll('-', '');
const factId = revision.correction.factId;
assert.match(factId, /^f\d+$/);
await fs.mkdir(destination, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
// Screenshot collection may read CUTBACK and fill local form controls. It must
// never analyse, plan, render, or alter a stored project.
await page.route(base + '/api/**', (route) =>
  route.request().method() === 'GET' ? route.continue() : route.abort(),
);
async function seekPair(times) {
  await page.locator('.comparison-grid video').evaluateAll((videos, times) => {
    videos.forEach((v, i) => {
      v.pause();
      v.muted = true;
      v.currentTime = times[i];
    });
  }, times);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.comparison-grid video')].every(
      (v) => !v.seeking && v.readyState >= 2,
    ),
  );
  await page
    .locator('.comparison-grid video')
    .evaluateAll((videos) => Promise.all(videos.map((v) => v.play())));
  await page.waitForFunction(
    (times) =>
      [...document.querySelectorAll('.comparison-grid video')].every(
        (v, i) => v.currentTime > times[i] + 0.2,
      ),
    times,
  );
  await page
    .locator('.comparison-grid video')
    .evaluateAll((videos) => videos.forEach((v) => v.pause()));
  await page.waitForTimeout(200);
}
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByLabel('Choose video file').setInputFiles('demo-kit/speaker-comparison.mp4');
  await page.locator('.attach-source input').setInputFiles('demo-kit/original-sources.txt');
  await page.waitForFunction(() =>
    document.querySelector('.source-input-panel textarea')?.value.includes('Orbit Mini'),
  );
  await page.locator('.drop-area video').evaluate(async (video) => {
    video.muted = true;
    video.currentTime = 1.5;
    await video.play();
  });
  await page.waitForFunction(() => document.querySelector('.drop-area video')?.currentTime > 1.7);
  await page.locator('.drop-area video').evaluate((video) => video.pause());
  await page.waitForTimeout(200);
  await page.screenshot({ path: destination + '/upload-start.png', fullPage: true });
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const index = projects.findIndex((p) => p.id === project.id);
  await page.locator('.project-row').nth(index).click();
  await page.getByRole('heading', { name: 'A new cut, with a reason for every edit.' }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.comparison-grid video')].every((v) => v.readyState >= 1),
  );
  const cost = project.scenes.find((s) => s.layout === 'cost');
  await seekPair([cost.start + 1.5, cost.start + 1.5]);
  await page.screenshot({
    path: destination + '/upload-cost-comparison.png',
    clip: { x: 0, y: 0, width: 1440, height: 850 },
  });
  const verdict = project.scenes.find((s) => s.layout === 'verdict');
  let revisedStart = 0;
  for (const scene of project.scenes) {
    if (scene.id === verdict.id) break;
    if (revision.affectedIds.includes(scene.id)) {
      const file =
        '.cutback-upload/media/' + project.id + '/' + revision.id + '/' + scene.id + '/clip.mp4';
      revisedStart += Number(
        execFileSync(
          ffprobe.path,
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
          { encoding: 'utf8' },
        ),
      );
    } else revisedStart += scene.end - scene.start;
  }
  await seekPair([verdict.start + 1.5, revisedStart + 1.5]);
  await page.screenshot({
    path: destination + '/upload-verdict-comparison.png',
    clip: { x: 0, y: 0, width: 1440, height: 850 },
  });
  await page.getByRole('button', { name: /Review the graph/ }).click();
  await page.locator('.fact-review').first().waitFor();
  await page.screenshot({ path: destination + '/upload-facts.png' });
  await page.getByRole('button', { name: 'Dependency graph', exact: true }).click();
  await page.locator('.graph-node').first().waitFor();
  await page.screenshot({ path: destination + '/upload-graph.png' });

  const db = await context.newPage();
  await db.setViewportSize({ width: 1600, height: 1000 });
  await db.goto(dbBrowser, { waitUntil: 'networkidle' });
  await db.getByPlaceholder('localhost', { exact: true }).fill('localhost');
  await db.getByPlaceholder('6379', { exact: true }).fill('6379');
  await db.getByRole('button', { name: 'Log in', exact: true }).click();
  await db.getByRole('button', { name: 'Skip Tutorial', exact: true }).click();
  await db.getByRole('button', { name: 'Select Graph', exact: true }).click();
  await db.getByText(graph, { exact: true }).click();
  const query = `MATCH p=(f:Fact {id:'${factId}'})-[:SUPPORTS|APPEARS_IN*1..4]->(s:Scene) RETURN p`;
  await db.keyboard.press('Escape');
  await db.getByRole('code').click();
  await db.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await db.keyboard.insertText(query);
  await db.getByRole('button').filter({ hasText: /^RUN$/ }).click();
  await db.getByText(/^Nodes: [1-9]/).waitFor();
  await db.getByRole('button', { name: 'Select graph layout', exact: true }).click();
  await db.getByRole('menuitem', { name: 'Tree layout', exact: true }).hover();
  await db.getByRole('menuitem', { name: 'Tree direction Left → Right', exact: true }).click();
  const fit = db.getByRole('button', { name: 'Fit graph to screen', exact: true });
  if (await fit.isVisible()) await fit.click();
  for (let i = 0; i < 10; i++)
    await db.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await db.mouse.move(10, 990);
  await db.waitForTimeout(1000);
  await db.screenshot({ path: destination + '/upload-falkordb.png' });
  const after = await fetch(base + '/api/status').then((r) => r.json());
  assert.deepEqual(after.budget, before.budget, 'Screenshot capture must not spend API credit.');
  const unchanged = await fetch(base + '/api/projects/' + project.id).then((r) => r.json());
  assert.deepEqual(unchanged, project, 'Screenshot capture must not change the project.');
  const metadata = {
    projectId: project.id,
    graph,
    factId,
    revisionId: revision.id,
    affectedIds: revision.affectedIds,
    preservedIds: revision.preservedIds,
    modelCalls: 0,
  };
  await fs.writeFile('artifacts/article-capture.json', JSON.stringify(metadata, null, 2));
  console.log(metadata);
} finally {
  await browser.close();
}
