import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIGINAL,
  CORRECTED,
  calculate,
  changedFields,
  correctionSchema,
  expectedFraming,
  validatePlan,
  buildScenes,
} from '../server/story.js';
import { captionChunks } from '../server/render.js';
import { createToolSession } from '../server/tool-session.js';

test('a missing required component reverses the price recommendation', () => {
  const before = calculate(ORIGINAL),
    after = calculate(CORRECTED);
  assert.equal(before.orbitTotal, 7900);
  assert.equal(before.savings, 4000);
  assert.equal(before.winner, 'orbit');
  assert.equal(after.orbitTotal, 12800);
  assert.equal(after.winner, 'forma');
  assert.equal(after.savings, 900);
  assert.deepEqual(changedFields(ORIGINAL, CORRECTED), ['adapterIncluded']);
  assert.equal(expectedFraming(before, after), 'reversal');
});
test('ties and fractional dollar prices do not invent a winner or round away cents', () => {
  const tie = calculate({ ...CORRECTED, orbitAdapter: 4000 });
  assert.equal(tie.winner, 'tie');
  assert.equal(tie.savings, 0);
  const cents = calculate({ ...CORRECTED, orbitBase: 7901, orbitAdapter: 4000 });
  assert.equal(cents.savings, 1);
  assert.equal(cents.winner, 'forma');
  const scenes = buildScenes({ ...CORRECTED, orbitAdapter: 4000 }, tie);
  assert.match(scenes[2].narration, /it is a tie/);
});
test('invalid source facts and stale-shaped payloads are rejected', () => {
  for (const value of [-1, 1.25, Infinity, 1000001])
    assert.throws(() => calculate({ ...ORIGINAL, orbitBase: value }));
  assert.throws(() =>
    correctionSchema.parse({
      expectedRevision: 1,
      evidence: ORIGINAL,
      sourceNote: '',
      extra: 'ignored?',
    }),
  );
});
test('editor cannot change unrelated scenes or contradict the computed winner', () => {
  const before = calculate(ORIGINAL),
    after = calculate(CORRECTED);
  assert.throws(() =>
    validatePlan(
      { sceneIds: ['opening', 'cost', 'verdict'], framing: 'reversal', transition: 'look_closer' },
      ['cost', 'verdict'],
      before,
      after,
    ),
  );
  assert.throws(() =>
    validatePlan(
      { sceneIds: ['cost', 'verdict'], framing: 'confirmed', transition: 'look_closer' },
      ['cost', 'verdict'],
      before,
      after,
    ),
  );
  assert.throws(() =>
    validatePlan(
      { sceneIds: ['cost', 'cost'], framing: 'reversal', transition: 'look_closer' },
      ['cost', 'verdict'],
      before,
      after,
    ),
  );
  validatePlan(
    { sceneIds: ['verdict', 'cost'], framing: 'reversal', transition: 'full_picture' },
    ['cost', 'verdict'],
    before,
    after,
  );
});
test('captions preserve every narration word in sequence', () => {
  for (const scene of buildScenes(CORRECTED, calculate(CORRECTED)))
    assert.equal(captionChunks(scene.narration).join(' '), scene.narration);
});
test('agent tool discovery and invocation use a real MCP transport', async () => {
  const calls: string[] = [];
  const session = await createToolSession(async (name, args) => {
    calls.push(name);
    return { ok: true, args };
  });
  try {
    assert.deepEqual(session.tools.map((t) => t.name).sort(), [
      'calculate_costs',
      'read_scene',
      'submit_edit_plan',
      'trace_impact',
    ]);
    assert.deepEqual(await session.call('read_scene', { sceneId: 'cost' }), {
      ok: true,
      args: { sceneId: 'cost' },
    });
    await assert.rejects(() => session.call('read_scene', { sceneId: 'imaginary' }));
    assert.deepEqual(calls, ['read_scene']);
  } finally {
    await session.close();
  }
});
