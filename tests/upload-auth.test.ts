import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { ChatGPTAuth } from '../server/upload/auth.js';

test('ChatGPT verifies a signed identity, persists registration and serializes token rotation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cutback-auth-'));
  const file = path.join(dir, 'credentials.json');
  const originalFetch = globalThis.fetch;
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'fixture', alg: 'RS256', use: 'sig' };
  const auth = new ChatGPTAuth(file);
  await auth.initialize();
  const url = new URL(auth.begin());
  const clientId = 'fixture-issued-client';
  const idToken = await new SignJWT({
    nonce: url.searchParams.get('nonce'),
    email: 'fixture@example.invalid',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer('https://auth.openai.com')
    .setAudience(clientId)
    .setSubject('fixture-account')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  let refreshCalls = 0;
  globalThis.fetch = async (input, init) => {
    const endpoint = String(input instanceof Request ? input.url : input);
    if (endpoint.endsWith('/openid-configuration'))
      return Response.json({
        issuer: 'https://auth.openai.com',
        jwks_uri: 'https://auth.openai.com/fixture-jwks',
      });
    if (endpoint.endsWith('/fixture-jwks')) return Response.json({ keys: [jwk] });
    if (endpoint.endsWith('/oauth/token')) {
      const body = new URLSearchParams(init?.body as string);
      assert.equal(body.get('client_id'), clientId);
      if (body.get('grant_type') === 'refresh_token') {
        refreshCalls++;
        assert.equal(body.get('refresh_token'), 'fixture-refresh-1');
        await new Promise((r) => setTimeout(r, 20));
        return Response.json({
          access_token: 'fixture-access-2',
          refresh_token: 'fixture-refresh-2',
          expires_in: 3600,
        });
      }
      assert.ok(body.get('code_verifier'));
      return Response.json({
        access_token: 'fixture-access-1',
        refresh_token: 'fixture-refresh-1',
        id_token: idToken,
        expires_in: 0,
        scope: 'openid chatgpt.tokens.use.direct',
      });
    }
    throw new Error('Unexpected request: ' + endpoint);
  };
  try {
    await auth.callback(
      new URLSearchParams({
        state: url.searchParams.get('state')!,
        code: 'fixture-code',
        client_id: clientId,
      }),
    );
    assert.equal(auth.status().planEnabled, true);
    assert.deepEqual(await Promise.all([auth.access(), auth.access()]), [
      'fixture-access-2',
      'fixture-access-2',
    ]);
    assert.equal(refreshCalls, 1);
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(saved.accounts[0].refreshToken, 'fixture-refresh-2');
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const restarted = new ChatGPTAuth(file);
    await restarted.initialize();
    assert.equal(await restarted.access(), 'fixture-access-2');
    const returning = new URL(restarted.begin(clientId));
    assert.equal(returning.searchParams.get('client_id'), clientId);
    assert.equal(
      returning.searchParams.get('ext_agent_host_id'),
      url.searchParams.get('ext_agent_host_id'),
    );
    // A signed token for a different sign-in attempt must still fail nonce validation.
    await assert.rejects(
      restarted.callback(
        new URLSearchParams({
          state: returning.searchParams.get('state')!,
          code: 'fixture-code',
          client_id: clientId,
        }),
      ),
      /identity validation/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
