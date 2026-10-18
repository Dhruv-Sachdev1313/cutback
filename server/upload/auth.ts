import { randomBytes, randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { uploadConfig } from './config.js';
const AUTH = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
type Account = {
  clientId: string;
  subject: string;
  email: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  scopes: string[];
};
type Saved = { hostId: string; active?: string; accounts: Account[] };
type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  clientId: string;
  subject?: string;
  redirect: string;
  expires: number;
};
export class ChatGPTAuth {
  private data: Saved = { hostId: 'urn:uuid:' + randomUUID(), accounts: [] };
  private pending = new Map<string, Pending>();
  private refreshing = new Map<string, Promise<string>>();
  constructor(private file = path.join(uploadConfig.root, 'chatgpt-credentials.json')) {}
  async initialize() {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      this.data = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await this.persist();
    }
  }
  private async persist() {
    const tmp = this.file + '.' + randomUUID() + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.data), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    await fs.chmod(this.file, 0o600);
  }
  status() {
    const active = this.data.accounts.find((a) => a.clientId === this.data.active);
    return {
      connected: !!active?.accessToken,
      planEnabled: !!active?.accessToken && active.scopes.includes('chatgpt.tokens.use.direct'),
      active: this.data.active,
      accounts: this.data.accounts.map((a) => ({
        id: a.clientId,
        email: a.email,
        connected: !!a.accessToken,
        planEnabled: a.scopes.includes('chatgpt.tokens.use.direct'),
      })),
    };
  }
  begin(accountId?: string) {
    const account = accountId
      ? this.data.accounts.find((a) => a.clientId === accountId)
      : undefined;
    if (accountId && !account) throw new Error('Unknown saved account.');
    for (const [s, p] of this.pending) if (p.expires < Date.now()) this.pending.delete(s);
    const p: Pending = {
      state: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'),
      verifier: randomBytes(48).toString('base64url'),
      clientId: account?.clientId || 'dynamic_agent_client',
      subject: account?.subject,
      redirect: `http://127.0.0.1:${uploadConfig.port}/auth/callback`,
      expires: Date.now() + 10 * 60_000,
    };
    this.pending.set(p.state, p);
    const u = new URL(AUTH + '/api/accounts/authorize');
    const params: Record<string, string> = {
      client_id: p.clientId,
      ext_agent_host_id: this.data.hostId,
      response_type: 'code',
      redirect_uri: p.redirect,
      scope: scopes,
      resource: RESOURCE,
      state: p.state,
      nonce: p.nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(p.verifier).digest('base64url'),
    };
    if (!account) params.agent_name_hint = 'CUTBACK';
    if (account?.idToken) params.id_token_hint = account.idToken;
    if (account?.email) params.login_hint = account.email;
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  }
  private async token(params: Record<string, string>) {
    const res = await fetch(AUTH + '/api/accounts/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok)
      throw new Error(`ChatGPT token exchange failed (${res.status}). Start sign-in again.`);
    const token = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in: number;
      scope?: string;
    };
    if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in < 0)
      throw new Error('ChatGPT returned an incomplete access token. Sign in again.');
    return token;
  }
  async callback(params: URLSearchParams) {
    const state = params.get('state') || '';
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || p.expires < Date.now())
      throw new Error('Sign-in expired or state did not match. Start again.');
    if (params.get('error'))
      throw new Error('ChatGPT sign-in was not completed. You can try again or select API credit.');
    const clientId = params.get('client_id') || p.clientId;
    if (
      clientId === 'dynamic_agent_client' ||
      (p.clientId !== 'dynamic_agent_client' && clientId !== p.clientId)
    )
      throw new Error('ChatGPT returned an invalid client registration.');
    const code = params.get('code');
    if (!code) throw new Error('No authorization code was returned.');
    const t = await this.token({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: p.verifier,
      redirect_uri: p.redirect,
      resource: RESOURCE,
    });
    if (!t.id_token || !t.access_token) throw new Error('The sign-in response is incomplete.');
    const config = (await fetch(AUTH + '/.well-known/openid-configuration', {
      signal: AbortSignal.timeout(20_000),
    }).then((r) => r.json())) as { issuer: string; jwks_uri: string };
    if (config.issuer !== AUTH || new URL(config.jwks_uri).origin !== AUTH)
      throw new Error('Unexpected OpenID configuration.');
    const { payload } = await jwtVerify(t.id_token, createRemoteJWKSet(new URL(config.jwks_uri)), {
      issuer: AUTH,
      audience: clientId,
      requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
    });
    if (!payload.sub || payload.nonce !== p.nonce || (p.subject && payload.sub !== p.subject))
      throw new Error('ChatGPT identity validation failed.');
    const a: Account = {
      clientId,
      subject: payload.sub,
      email: String(payload.email || 'ChatGPT account'),
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      idToken: t.id_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      scopes: (t.scope || '').split(' '),
    };
    const existing = this.data.accounts.find((x) => x.clientId === clientId);
    if (existing && existing.subject !== a.subject)
      throw new Error('The account does not match this registration.');
    this.data.accounts = this.data.accounts.filter((x) => x.clientId !== clientId).concat(a);
    this.data.active = clientId;
    await this.persist();
    return this.status();
  }
  async access(): Promise<string> {
    const a = this.data.accounts.find((x) => x.clientId === this.data.active);
    if (!a?.accessToken || !a.scopes.includes('chatgpt.tokens.use.direct'))
      throw new Error('Connect a ChatGPT account and enable plan usage first.');
    if (a.expiresAt > Date.now() + 60_000) return a.accessToken;
    const existingRefresh = this.refreshing.get(a.clientId);
    if (existingRefresh) return existingRefresh;
    const refresh = (async () => {
      if (!a.refreshToken) throw new Error('Sign in to ChatGPT again to renew access.');
      const t = await this.token({
        grant_type: 'refresh_token',
        client_id: a.clientId,
        refresh_token: a.refreshToken,
        resource: RESOURCE,
      });
      a.accessToken = t.access_token;
      a.refreshToken = t.refresh_token || a.refreshToken;
      a.idToken = t.id_token || a.idToken;
      a.expiresAt = Date.now() + t.expires_in * 1000;
      if (t.scope !== undefined) a.scopes = t.scope.split(' ');
      await this.persist();
      if (!a.scopes.includes('chatgpt.tokens.use.direct'))
        throw new Error('ChatGPT plan permission is no longer enabled.');
      return a.accessToken!;
    })();
    this.refreshing.set(a.clientId, refresh);
    try {
      return await refresh;
    } finally {
      this.refreshing.delete(a.clientId);
    }
  }
  async select(id: string) {
    if (!this.data.accounts.some((a) => a.clientId === id)) throw new Error('Unknown account.');
    this.data.active = id;
    await this.persist();
  }
  async disconnect() {
    const a = this.data.accounts.find((x) => x.clientId === this.data.active);
    if (!a) return { revoked: true };
    await this.refreshing.get(a.clientId)?.catch(() => {});
    let revoked = !a.refreshToken;
    if (a.refreshToken) {
      try {
        const c = (await fetch(AUTH + '/.well-known/openid-configuration', {
          signal: AbortSignal.timeout(10_000),
        }).then((r) => r.json())) as { revocation_endpoint: string };
        if (new URL(c.revocation_endpoint).origin !== AUTH)
          throw new Error('Invalid revocation endpoint');
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await fetch(c.revocation_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: a.refreshToken,
              token_type_hint: 'refresh_token',
              client_id: a.clientId,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (r.ok) {
            revoked = true;
            break;
          }
          if (r.status < 500) break;
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch {
        /* Clear local tokens even when remote revocation cannot be confirmed. */
      }
    }
    delete a.accessToken;
    delete a.refreshToken;
    delete a.idToken;
    a.scopes = [];
    a.expiresAt = 0;
    await this.persist();
    return { revoked };
  }
  async models() {
    const r = await fetch(RESOURCE + '/models', {
      headers: { Authorization: 'Bearer ' + (await this.access()) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`Could not load ChatGPT models (${r.status}).`);
    const body = (await r.json()) as {
      models?: { slug: string; display_name: string; visibility: string }[];
    };
    return (body.models || [])
      .filter((m) => m.visibility === 'list')
      .map((m) => ({ id: m.slug, name: m.display_name }));
  }
}
