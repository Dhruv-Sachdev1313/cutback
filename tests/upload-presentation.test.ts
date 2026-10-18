import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { UploadProject } from '../shared/upload.js';
import {
  alignSpeakerClaims,
  compilePresentation,
  detectRenderProfile,
  presentationSvg,
  speakerEvidence,
} from '../server/upload/presentation.js';

const project = (fee: number) =>
  ({
    renderProfile: 'speaker-study-v1',
    facts: [{ id: 'f2', text: 'The required adapter is included in the $79 price.' }],
    correction: {
      factId: 'f2',
      text: `Orbit Mini's adapter is not included. It is bought separately for $${fee}.`,
      source: 'Revised fictional product sheet.',
    },
    scenes: [
      { id: 's1', layout: 'cost' },
      { id: 's2', layout: 'verdict' },
    ],
  }) as UploadProject;
const edits = ['s1', 's2'].map((sceneId) => ({
  sceneId,
  title: 'Correction card: old title',
  narration: 'Correction: old narration.',
  reason: 'Graph dependency',
}));

test('editable layouts recognise video bytes, regardless of filename', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cutback-profile-'));
  try {
    const renamed = path.join(dir, 'my-film.mp4');
    await fs.copyFile('demo-kit/speaker-comparison.mp4', renamed);
    assert.equal(await detectRenderProfile(renamed), 'speaker-study-v1');
    await fs.writeFile(renamed, 'unrelated video bytes');
    assert.equal(await detectRenderProfile(renamed), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('rebuilding the film changes the chart, spoken total and recommendation together', () => {
  const rendered = compilePresentation(project(49), edits);
  assert.deepEqual(
    rendered.map((e) => e.sceneId),
    ['s1', 's2'],
  );
  assert.match(rendered[0].narration, /Total cost: \$128/);
  assert.match(rendered[1].narration, /Forma One costs \$9 less/);
  const cost = presentationSvg(rendered[0], '');
  const verdict = presentationSvg(rendered[1], '');
  assert.match(cost, /\$128/);
  assert.match(cost, /\$119/);
  assert.match(verdict, /FORMA/);
  assert.match(verdict, /\$9 LESS/);
  assert.doesNotMatch(
    rendered.map((e) => e.narration).join(' ') + cost + verdict,
    /correction|updated version/i,
  );
});
test('the layout supports a different winner and a tie, rather than a fixed reversal', () => {
  assert.match(compilePresentation(project(20), edits)[1].narration, /Orbit Mini costs \$20 less/);
  assert.match(compilePresentation(project(40), edits)[1].narration, /Both cost \$119/);
  const usd = project(49);
  usd.correction!.text = 'The adapter is sold separately for USD 49.50.';
  assert.equal(speakerEvidence(usd).orbitAdapter, 4950);
});
test('an incomplete source change cannot silently render a guessed adapter price', () => {
  const p = project(49);
  p.correction!.text = 'The required adapter is not included.';
  assert.throws(() => compilePresentation(p, edits), /separate adapter price/);
  p.correction!.text = 'The adapter might have changed.';
  assert.throws(() => compilePresentation(p, edits), /whether the adapter/);
});
test('saved claims align with the real cost, verdict and closing scenes', () => {
  const claims = alignSpeakerClaims([
    { id: 'c1', text: 'Orbitmini starts at $79.', factIds: ['f1'], sceneIds: ['s0'] },
    {
      id: 'c2',
      text: 'Orbit costs $40 less and is the lower-cost pick.',
      factIds: ['f1', 'f2'],
      sceneIds: ['s1', 's2'],
    },
    { id: 'c3', text: 'Both products are fictional.', factIds: ['f3'], sceneIds: ['s2'] },
  ]);
  assert.deepEqual(
    claims.map((c) => c.sceneIds),
    [['s1'], ['s2'], ['s3']],
  );
  assert.deepEqual(claims[1].factIds, ['f1', 'f2']);
});
