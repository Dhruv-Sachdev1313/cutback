import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneBoundaries } from '../server/upload/media.js';
import { validateAnalysis, validateEdits } from '../server/upload/schema.js';
import { ChatGPTAuth } from '../server/upload/auth.js';
import { Model } from '../server/upload/model.js';
import type { UploadProject } from '../shared/upload.js';
test('scene segmentation covers the full video and bounds crowded cut lists', () => {
  assert.deepEqual(sceneBoundaries(25, []), [0, 12, 25]);
  const bounds = sceneBoundaries(
    120,
    Array.from({ length: 39 }, (_, i) => (i + 1) * 3),
  );
  assert.equal(bounds[0], 0);
  assert.equal(bounds.at(-1), 120);
  assert.ok(bounds.length <= 13);
  assert.ok(bounds.every((x, i) => i === 0 || x > bounds[i - 1]));
});
test('quotes must resolve to actual evidence and graph links must resolve to actual scenes', () => {
  const p = {
    evidence: [{ id: 'speech0', kind: 'speech', text: 'The bus costs twenty dollars.' }],
    scenes: [{ id: 's0' }],
  } as UploadProject;
  const fact = {
    id: 'f1',
    text: 'Bus fare is $20',
    evidenceId: 'speech0',
    quote: 'twenty dollars',
  };
  const claim = { id: 'c1', text: 'Cost', factIds: ['f1'], sceneIds: ['s0'] };
  assert.doesNotThrow(() => validateAnalysis(p, [fact], [claim]));
  assert.throws(
    () => validateAnalysis(p, [{ ...fact, quote: 'ten dollars' }], [claim]),
    /quoted passage/,
  );
  assert.throws(
    () => validateAnalysis(p, [fact], [{ ...claim, sceneIds: ['s99'] }]),
    /missing fact or scene/,
  );
  assert.throws(() => validateAnalysis(p, [fact, fact], [claim]), /duplicate/);
});
test('an edit plan cannot modify extra scenes or omit an affected scene', () => {
  const edit = {
    sceneId: 's1',
    title: 'Correction',
    narration: 'The bus costs thirty dollars.',
    reason: 'Price update',
  };
  assert.doesNotThrow(() => validateEdits(['s1'], [edit]));
  assert.throws(() => validateEdits(['s1', 's2'], [edit]));
  assert.throws(() => validateEdits(['s1'], [edit, { ...edit, sceneId: 's0' }]));
  assert.throws(() => validateEdits(['s1'], [edit, edit]));
});
test('ChatGPT authorization uses PKCE, a loopback callback and state validation', async () => {
  const auth = new ChatGPTAuth();
  const url = new URL(auth.begin());
  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(new URL(url.searchParams.get('redirect_uri')!).hostname, '127.0.0.1');
  assert.ok(url.searchParams.get('scope')?.includes('chatgpt.tokens.use.direct'));
  assert.notEqual(url.searchParams.get('state'), new URL(auth.begin()).searchParams.get('state'));
  await assert.rejects(
    () => auth.callback(new URLSearchParams({ state: 'wrong', code: 'code' })),
    /state did not match/,
  );
});
test('subscription requests stream with the supported fields and never reserve API credit', async () => {
  const old = globalThis.fetch;
  let calls = 0;
  let sent: any;
  globalThis.fetch = async (_url, init) => {
    calls++;
    sent = JSON.parse(init?.body as string);
    return new Response(
      'data: ' +
        JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'test',
            object: 'response',
            status: 'completed',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        }) +
        '\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };
  try {
    const auth = { access: async () => 'test-token' } as any;
    const budget = {
      reserve: async () => {
        throw new Error('Must not bill API credit');
      },
    } as any;
    const m = new Model(auth, budget);
    await m.respond('chatgpt', 'gpt-6.1-sol', [{ role: 'user', content: 'Hi' }], 'Instructions', [
      {
        type: 'function',
        name: 'trace_impact',
        description: 'Graph query',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        strict: true,
      },
    ]);
    assert.equal(calls, 1);
    assert.equal(sent.store, false);
    assert.equal(sent.stream, true);
    assert.equal(sent.max_output_tokens, undefined);
    assert.equal(sent.tools[0].type, 'namespace');
  } finally {
    globalThis.fetch = old;
  }
});

test('an incomplete ChatGPT stream fails without retrying or falling back to API credit', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const model = new Model(
      { access: async () => 'fixture-token' } as any,
      {
        reserve: async () => {
          throw new Error('Unexpected API reservation');
        },
      } as any,
    );
    await assert.rejects(
      model.respond('chatgpt', 'gpt-6.1-sol', [{ role: 'user', content: 'Hi' }], 'Test'),
      /before completion/,
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
