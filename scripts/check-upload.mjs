import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = 'http://127.0.0.1:4328';
const before = await fetch(base + '/api/status').then((r) => r.json());
const projects = await fetch(base + '/api/projects').then((r) => r.json());
await fs.mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: 'reduce',
});
const errors = [];
page.setDefaultTimeout(10000);
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('NEW PROJECT · NO HISTORY YET').waitFor();
  assert.equal(await page.locator('.revision-history').count(), 0);
  await page.screenshot({ path: 'artifacts/upload-home.png', fullPage: true });
  await page.getByLabel('Choose video file').setInputFiles('demo-kit/speaker-comparison.mp4');
  await page.locator('.attach-source input').setInputFiles('demo-kit/original-sources.txt');
  await page.waitForFunction(() =>
    document.querySelector('.source-input-panel textarea')?.value.includes('Orbit Mini'),
  );
  assert.equal(await page.locator('.drop-area video').count(), 1);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  assert.equal(await page.locator('.drop-area video').count(), 0);
  assert.equal(await page.locator('.source-input-panel textarea').first().inputValue(), '');

  const completed = projects.find((p) => p.status === 'complete');
  if (completed) {
    const savedProject = await fetch(base + '/api/projects/' + completed.id).then((r) => r.json());
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.locator('.project-row').filter({ hasText: completed.title }).first().click();
    await page.getByRole('heading', { name: 'A new cut, with a reason for every edit.' }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.comparison-grid video')].every((v) => v.readyState >= 1),
    );
    for (const poster of await page
      .locator('.comparison-grid video')
      .evaluateAll((vs) => vs.map((v) => v.poster)))
      assert.equal((await fetch(poster)).status, 200);
    await page.getByRole('button', { name: 'Jump to first edit' }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.comparison-grid video')].every(
        (v) => v.currentTime > 0 && !v.seeking && v.readyState >= 2,
      ),
    );
    const starts = await page.locator('.comparison-grid video').evaluateAll(async (videos) => {
      const times = videos.map((v) => v.currentTime);
      await Promise.all(
        videos.map(async (v) => {
          v.muted = true;
          await v.play();
        }),
      );
      return times;
    });
    await page.waitForFunction(
      (times) =>
        [...document.querySelectorAll('.comparison-grid video')].every(
          (v, i) => v.currentTime > times[i] + 0.3,
        ),
      starts,
    );
    await page
      .locator('.comparison-grid video')
      .evaluateAll((videos) => videos.forEach((v) => v.pause()));
    await page.screenshot({ path: 'artifacts/upload-complete.png', fullPage: true });
    await page.getByRole('button', { name: /Review the graph/ }).click();
    await page.getByRole('button', { name: 'Dependency graph', exact: true }).click();
    await page.locator('.graph-node').first().waitFor();
    assert.ok((await page.locator('.graph-edge').count()) > 0);
    await page.screenshot({ path: 'artifacts/upload-graph.png', fullPage: true });
    await page.locator('.graph-node.source').first().click();
    await page.locator('.graph-node.fact').first().click();
    await page.getByRole('button', { name: /Make a correction/ }).click();
    assert.equal(
      await page.getByLabel('Fact to correct').inputValue(),
      savedProject.correction.factId,
      'Exploring graph nodes must not change the correction form.',
    );
    assert.ok(
      (await page.getByRole('textbox', { name: /^Corrected fact/ }).inputValue()).length > 0,
    );
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    assert.equal(await page.locator('.activity-log,.revision-history,.comparison-grid').count(), 0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile page must not overflow horizontally.',
  );
  await page.screenshot({ path: 'artifacts/upload-mobile.png', fullPage: true });
  const unauthorized = await fetch(base + '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: 'fixture',
  });
  assert.equal(unauthorized.status, 403);
  const crossOrigin = await fetch(base + '/api/status', {
    headers: { Origin: 'https://example.invalid' },
  });
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(errors, []);
  const after = await fetch(base + '/api/status').then((r) => r.json());
  assert.deepEqual(after.budget, before.budget, 'Read-only UI checks must not spend API credit.');
  const report = {
    passed: true,
    completedProjectChecked: !!completed,
    modelCalls: 0,
    budgetUnchanged: true,
    browserErrors: errors,
  };
  await fs.writeFile('artifacts/upload-browser-check.json', JSON.stringify(report, null, 2));
  console.log(report);
} catch (e) {
  await page.screenshot({ path: 'artifacts/upload-check-failed.png', fullPage: true });
  throw e;
} finally {
  await browser.close();
}
