import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.FALKORDB_BROWSER_URL || 'http://127.0.0.1:6388';
const graph = process.env.FALKORDB_GRAPH || 'cutback';
const destination = 'docs/article-assets';
const impactQuery =
  "MATCH p=(f:Artifact {id:'fact_adapterIncluded'})-[:FEEDS*1..8]->(s:Artifact {kind:'scene'}) RETURN p";
const tableQuery =
  "MATCH p=(f:Artifact {id:'fact_adapterIncluded'})-[:FEEDS*1..8]->(s:Artifact {kind:'scene'}) WITH s, [n IN nodes(p) | n.title] AS steps RETURN steps[0] AS fact, steps[1] AS calculation, steps[2] AS claim, s.title AS scene";

await fs.mkdir(destination, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);

async function runQuery(query) {
  await page.keyboard.press('Escape');
  await page.getByRole('code').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(query);
  await page.getByRole('button').filter({ hasText: /^RUN$/ }).click();
  await page.waitForTimeout(1800);
}

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  // The Browser server and database run inside the same container. These are
  // its internal connection details, not the native API's host-mapped port.
  await page.getByPlaceholder('localhost', { exact: true }).fill('localhost');
  await page.getByPlaceholder('6379', { exact: true }).fill('6379');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('button', { name: 'Skip Tutorial', exact: true }).click();
  await page.getByRole('button', { name: 'Select Graph', exact: true }).click();
  await page.getByText(graph, { exact: true }).click();
  await runQuery(impactQuery);
  await page.getByText('Nodes: 6', { exact: true }).waitFor();
  await page.getByText('Edges: 5', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Select graph layout', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tree layout', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Tree direction Left → Right', exact: true }).click();
  const fit = page.getByRole('button', { name: 'Fit graph to screen', exact: true });
  if (await fit.isVisible()) await fit.click();
  for (let index = 0; index < 5; index++) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  }
  await page.mouse.move(10, 1000);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: destination + '/falkordb-browser.png' });

  await runQuery(tableQuery);
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await page.getByText('02 · The real cost', { exact: false }).first().waitFor();
  await page.getByText('03 · The verdict', { exact: false }).first().waitFor();
  await page.getByText('Adapter included?', { exact: false }).first().waitFor();
  await page.getByText('Lower-cost choice', { exact: false }).first().waitFor();
  await page.mouse.move(10, 1000);
  await page.screenshot({
    path: destination + '/falkordb-impact-table.png',
    clip: { x: 0, y: 0, width: 1600, height: 480 },
  });
  console.log('Saved FalkorDB Browser graph and table screenshots.');
  console.log('Read-only impact query returned the cost and verdict scenes.');
} catch (error) {
  console.error(await page.locator('body').innerText());
  await page.screenshot({ path: '/tmp/cutback-falkordb-capture-error.png' });
  throw error;
} finally {
  await browser.close();
}
