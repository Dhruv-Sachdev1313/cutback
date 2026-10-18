import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { FalkorDB } from 'falkordb';
import { UploadStore } from '../../server/upload/store.js';
import { UploadPipeline } from '../../server/upload/pipeline.js';
import { uploadConfig } from '../../server/upload/config.js';
import type { UploadProject } from '../../shared/upload.js';

test('isolated FalkorDB projects control a real MCP plan and reject concurrent work', async () => {
  assert.equal(
    uploadConfig.dbPort,
    6397,
    'This test is restricted to the isolated upload database.',
  );
  const db = await FalkorDB.connect({
    socket: { host: '127.0.0.1', port: 6397, connectTimeout: 3000 },
  });
  const store = new UploadStore(db);
  const ids = [randomUUID(), randomUUID()];
  const makeProject = (id: string, sceneId: string): UploadProject => ({
    id,
    filename: 'fixture.mp4',
    title: 'Integration fixture',
    createdAt: new Date().toISOString(),
    originalUrl: '/uploads/fixture.mp4',
    duration: 20,
    width: 1280,
    height: 720,
    hasAudio: true,
    status: 'ready',
    provider: 'api',
    model: 'gpt-6.1-sol',
    sourceText: 'Bus fare is twenty dollars.',
    approved: true,
    revisions: [],
    events: [],
    evidence: [
      {
        id: 'document0',
        kind: 'document',
        text: 'Bus fare is twenty dollars.',
        start: 0,
        end: 0,
        sourceName: 'Fixture',
      },
    ],
    scenes: ['s0', 's1'].map((id, i) => ({
      id,
      title: 'Segment ' + i,
      start: i * 10,
      end: (i + 1) * 10,
      transcript: 'Fixture speech',
      frameUrl: '/uploads/fixture.jpg',
    })),
    facts: [
      { id: 'f1', text: 'Bus fare is $20.', quote: 'twenty dollars', evidenceId: 'document0' },
    ],
    claims: [{ id: 'c1', text: 'Fare conclusion', factIds: ['f1'], sceneIds: [sceneId] }],
  });
  try {
    for (const [i, id] of ids.entries()) {
      const p = makeProject(id, 's' + i);
      await store.build(p);
      await store.save(p);
    }
    assert.deepEqual((await store.impact(ids[0], 'f1')).sceneIds, ['s0']);
    assert.deepEqual((await store.impact(ids[1], 'f1')).sceneIds, ['s1']);
    // Change an actual edge; the permissible edit scope must change with it.
    await store.query(
      ids[0],
      "MATCH (:Claim {id:'c1'})-[r:APPEARS_IN]->(:Scene {id:'s0'}) DELETE r",
    );
    assert.deepEqual((await store.impact(ids[0], 'f1')).sceneIds, []);
    await store.build(makeProject(ids[0], 's0'));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let turn = 0;
    const scriptedModel = {
      respond: async () => {
        await gate;
        const calls = [
          { name: 'trace_impact', arguments: '{}' },
          { name: 'read_affected_scenes', arguments: '{}' },
          {
            name: 'submit_edit_plan',
            arguments: JSON.stringify({
              edits: [
                {
                  sceneId: 's0',
                  title: 'Updated fare',
                  narration: 'The fare is now thirty dollars.',
                  reason: 'New source sheet.',
                },
              ],
            }),
          },
        ];
        return {
          output: [{ type: 'function_call', call_id: 'fixture-' + turn, ...calls[turn++] }],
        };
      },
    };
    const pipeline = new UploadPipeline(store, scriptedModel as any);
    await pipeline.start(ids[0], 'plan', {
      factId: 'f1',
      text: 'Bus fare is $30.',
      source: 'Updated public fare sheet.',
    });
    try {
      await assert.rejects(
        pipeline.start(ids[0], 'plan', {
          factId: 'f1',
          text: 'Bus fare is $40.',
          source: 'Conflicting request.',
        }),
        /already has a job/,
      );
      await assert.rejects(pipeline.provider(ids[0], 'chatgpt', 'test'), /current job/);
    } finally {
      release();
    }
    let p = await store.get(ids[0]);
    for (let i = 0; i < 200 && p.status === 'planning'; i++) {
      await pause(10);
      p = await store.get(ids[0]);
    }
    assert.equal(p.status, 'plan', p.error);
    assert.deepEqual(
      p.edits?.map((e) => e.sceneId),
      ['s0'],
    );
    assert.ok(p.events.some((e) => e.tool === 'mcp_discovery'));
    assert.ok(p.events.some((e) => e.tool === 'trace_impact'));
    const untouched = await store.get(ids[1]);
    assert.equal(untouched.status, 'ready');
    assert.equal(untouched.revisions.length, 0);
    assert.deepEqual((await store.impact(ids[1], 'f1')).sceneIds, ['s1']);
  } finally {
    // Delete only the unique fixtures created above, including their index entries.
    for (const id of ids) {
      await db
        .selectGraph('cutback_upload_index')
        .query('MATCH (p:UploadProject {id:$id}) DETACH DELETE p', { params: { id } });
      await db.selectGraph(store.name(id)).delete();
    }
    await store.close();
  }
});
