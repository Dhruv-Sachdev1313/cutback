import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = process.env.CUTBACK_URL || 'http://127.0.0.1:4318';
await fs.mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'The everyday speaker test' }).waitFor();
  let before = await fetch(base + '/api/state').then((r) => r.json());
  assert.ok(before.latest, 'First cut must exist before browser QA.');
  if (
    !before.latest.evidence.adapterIncluded ||
    before.latest.evidence.orbitBase !== 7900 ||
    before.latest.evidence.formaBase !== 11900 ||
    before.latest.evidence.orbitAdapter !== 4900
  ) {
    await page.getByRole('button', { name: 'Restore original source values' }).click();
    await page.getByRole('button', { name: 'Rebuild affected scenes' }).click();
    await page.getByRole('heading', { name: 'Your new cut is ready' }).waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: 'Back to sources' }).click();
    await page.waitForTimeout(1000);
    before = await fetch(base + '/api/state').then((r) => r.json());
  }
  await page.screenshot({ path: 'artifacts/studio-before.png', fullPage: true });
  await page.getByRole('button', { name: 'Load the correction' }).click();
  await page.getByText('2 scenes will be reconsidered').waitFor();
  await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
  await page.screenshot({ path: 'artifacts/evidence-graph.png', fullPage: true });
  await page.getByRole('button', { name: 'Inspect the Cypher query' }).click();
  assert.match(await page.locator('.query-code').textContent(), /FEEDS\*1\.\.8/);
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  const request = page.waitForResponse(
    (r) => r.url() === base + '/api/revisions' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Rebuild affected scenes' }).click();
  const response = await request;
  assert.equal(response.status(), 202);
  const job = await response.json();
  await page.getByRole('heading', { name: 'Your new cut is ready' }).waitFor({ timeout: 150000 });
  await page.waitForTimeout(1000);
  const after = await fetch(base + '/api/state').then((r) => r.json());
  assert.equal(after.latest.calculation.winner, 'forma');
  assert.equal(after.latest.calculation.orbitTotal, 12800);
  assert.equal(after.latest.calculation.savings, 900);
  assert.equal(after.latest.revision, before.latest.revision + 1);
  for (const id of ['opening', 'outro'])
    assert.equal(
      after.latest.scenes.find((s) => s.id === id).footageHash,
      before.latest.scenes.find((s) => s.id === id).footageHash,
    );
  for (const id of ['cost', 'verdict'])
    assert.notEqual(
      after.latest.scenes.find((s) => s.id === id).footageHash,
      before.latest.scenes.find((s) => s.id === id).footageHash,
    );
  assert.equal(after.latest.scenes.filter((s) => s.rebuilt).length, 2);
  assert.equal(after.latest.scenes.filter((s) => !s.rebuilt).length, 2);
  const preservedMedia = {};
  for (const id of ['opening', 'outro']) {
    const originalScene = before.latest.scenes.find((s) => s.id === id);
    const revisedScene = after.latest.scenes.find((s) => s.id === id);
    assert.equal(revisedScene.videoUrl, originalScene.videoUrl);
    const bytes = Buffer.from(
      await fetch(base + revisedScene.videoUrl).then((r) => r.arrayBuffer()),
    );
    assert.ok(bytes.length > 1000, 'Preserved media must be a real file.');
    preservedMedia[id] = createHash('sha256').update(bytes).digest('hex');
  }
  const run = await fetch(base + '/api/runs/' + job.id).then((r) => r.json());
  assert.equal(run.status, 'complete');
  assert.ok(run.events.some((e) => e.tool === 'mcp_list_tools'));
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path: 'artifacts/studio-after.png', fullPage: true });
  await page.getByRole('button', { name: 'Compare cuts' }).click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({ path: 'artifacts/compare-cuts.png', fullPage: true });
  await page.getByRole('button', { name: 'Play both cuts' }).click();
  await page.waitForTimeout(2000);
  assert.ok(
    await page
      .locator('.compare-grid video')
      .first()
      .evaluate((v) => v.currentTime > 0),
  );
  await page.getByRole('button', { name: 'Close comparison' }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  assert.ok((await page.locator('.version-card').count()) >= 2);
  const mobile = await context.newPage();
  // Playwright viewport is a page setting; use an isolated page with no user data.
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(base, { waitUntil: 'networkidle' });
  await mobile.screenshot({ path: 'artifacts/studio-mobile.png', fullPage: true });
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await mobile.close();
  await fs.writeFile(
    'artifacts/browser-check.json',
    JSON.stringify(
      {
        passed: true,
        originalVersion: before.latest.id,
        revisedVersion: after.latest.id,
        mode: after.latest.mode,
        events: run.events.length,
        checks: after.latest.checks,
        preservedMediaSha256: preservedMedia,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: browser correction → MCP tools → FalkorDB traversal → new MP4 → comparison playback.',
  );
  console.log('Saved screenshots and test evidence in artifacts/.');
} finally {
  await browser.close();
}
