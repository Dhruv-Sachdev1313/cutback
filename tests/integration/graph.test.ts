import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GraphStore } from '../../server/store.js';
import { ORIGINAL } from '../../server/story.js';
import type { Run } from '../../shared/types.js';

test('real graph controls impact, persists candidate facts, and prevents concurrent revisions', async () => {
  const store = await GraphStore.connect('cutback_test_' + randomUUID().replaceAll('-', ''));
  try {
    await store.initialize();
    assert.equal(await store.health(), true);
    const impact = await store.impact(['adapterIncluded']);
    assert.deepEqual(impact.sceneIds.sort(), ['cost', 'verdict']);
    assert.equal(
      impact.paths.every((p) => p.ids[0] === 'fact_adapterIncluded'),
      true,
    );
    assert.equal(impact.nodes.includes('scene_opening'), false);
    // Changing a dependency in the actual database changes the edit decision.
    await store.query(
      "MATCH (:Artifact {id:'calc_orbit'})-[r:FEEDS]->(:Artifact {id:'claim_verdict'}) DELETE r",
    );
    assert.deepEqual((await store.impact(['adapterIncluded'])).sceneIds, ['cost']);
    await store.initialize();
    const makeRun = (): Run => ({
      id: randomUUID(),
      status: 'running',
      revision: 1,
      mode: 'local',
      events: [],
    });
    const first = makeRun(),
      second = makeRun();
    const results = await Promise.allSettled([
      store.startRun(first, ORIGINAL, 0, 'Test fixture'),
      store.startRun(second, ORIGINAL, 0, 'Test fixture'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const winner = results[0].status === 'fulfilled' ? first : second;
    assert.deepEqual(await store.candidateEvidence(winner.id), ORIGINAL);
    await store.appendEvent(winner.id, {
      seq: 1,
      time: new Date().toISOString(),
      role: 'evidence',
      tool: 'test',
      title: 'Persisted',
      detail: 'Read after reconnect',
      status: 'done',
    });
    assert.equal((await store.getRun(winner.id))?.events[0].title, 'Persisted');
    await store.failRun(winner.id, 'Intentional test cancellation');
    assert.equal(await store.activeRun(), null);
    await assert.rejects(() => store.startRun(makeRun(), ORIGINAL, 99, 'Stale revision'));
  } finally {
    // This graph name is unique to this test; never touch the application graph.
    await store.query('MATCH (n) DETACH DELETE n');
    await store.close();
  }
});
