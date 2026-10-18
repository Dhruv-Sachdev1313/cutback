import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { z, ZodError } from 'zod';
import { uploadConfig, urlFor } from './config.js';
import { ChatGPTAuth } from './auth.js';
import { Budget } from './budget.js';
import { Model } from './model.js';
import { UploadStore } from './store.js';
import { UploadPipeline } from './pipeline.js';
import { probe } from './media.js';
import { correctionSchema, analysisSchema } from './schema.js';
import type { UploadProject } from '../../shared/upload.js';
const app = express();
app.disable('x-powered-by');
const session = randomBytes(32).toString('hex');
// Loopback-only application. Prevent cross-site requests to local credentials/mutations.
app.use((req, res, next) => {
  const host = req.hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    res.status(403).json({ error: 'Loopback host required.' });
    return;
  }
  const origin = req.get('origin');
  if (
    origin &&
    !['http://127.0.0.1:' + uploadConfig.port, 'http://localhost:' + uploadConfig.port].includes(
      origin,
    )
  ) {
    res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    return;
  }
  if (
    req.path.startsWith('/api/') &&
    req.method !== 'GET' &&
    req.get('x-cutback-session') !== session
  ) {
    res.status(403).json({ error: 'Refresh this page before continuing.' });
    return;
  }
  next();
});
app.use('/uploads', express.static(uploadConfig.media, { dotfiles: 'deny' }));
app.use(express.json({ limit: '100kb' }));
await fs.mkdir(uploadConfig.media, { recursive: true });
const auth = new ChatGPTAuth();
const budget = new Budget();
await auth.initialize();
await budget.initialize();
const store = await UploadStore.connect();
const model = new Model(auth, budget);
const pipeline = new UploadPipeline(store, model);
for (const summary of (await store.list()) as { id: string }[]) {
  const p = await store.get(summary.id);
  if (['extracting', 'planning', 'rendering'].includes(p.status)) {
    p.status = 'failed';
    p.error = 'The server restarted during this job. Previous exports are intact.';
    await store.save(p);
  }
}
app.get('/api/status', async (_req, res) => {
  await store.list();
  res.json({
    session,
    apiConfigured: !!process.env.OPENAI_API_KEY,
    model: uploadConfig.model,
    budget: budget.status(),
    chatgpt: auth.status(),
    database: { connected: true, port: uploadConfig.dbPort, browser: 'http://localhost:6398' },
    maxSeconds: uploadConfig.maxSeconds,
  });
});
app.get('/api/projects', async (_req, res) => res.json(await store.list()));
app.get('/api/projects/:id', async (req, res) => res.json(await store.get(req.params.id)));
app.get('/api/projects/:id/graph', async (req, res) => res.json(await store.graph(req.params.id)));
app.post(
  '/api/projects',
  express.raw({ type: 'application/octet-stream', limit: '100mb' }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      throw new Error('Choose a video file first.');
    const id = randomUUID();
    const filename = path
      .basename(decodeURIComponent(req.get('x-filename') || 'video.mp4'))
      .slice(0, 160);
    if (!/\.(mp4|mov|webm|m4v)$/i.test(filename))
      throw new Error('Choose an MP4, MOV, M4V or WebM video.');
    const dir = path.join(uploadConfig.media, id);
    await fs.mkdir(dir, { recursive: true });
    const original = path.join(dir, 'original' + path.extname(filename).toLowerCase());
    await fs.writeFile(original, req.body);
    try {
      const info = await probe(original);
      const p: UploadProject = {
        id,
        filename,
        title: filename,
        createdAt: new Date().toISOString(),
        originalUrl: urlFor(id + '/' + path.basename(original)),
        ...info,
        status: 'uploaded',
        provider: 'api',
        model: uploadConfig.model,
        sourceText: '',
        evidence: [],
        scenes: [],
        facts: [],
        claims: [],
        approved: false,
        revisions: [],
        events: [
          {
            at: new Date().toISOString(),
            tool: 'upload',
            detail: `Uploaded ${filename}. The original is preserved.`,
          },
        ],
      };
      await store.save(p);
      res.status(201).json(p);
    } catch (e) {
      await fs.rm(dir, { recursive: true, force: true });
      throw e;
    }
  },
);
app.post('/api/projects/:id/analyse', async (req, res) => {
  const body = z
    .object({
      provider: z.enum(['api', 'chatgpt']),
      model: z.string().min(1).max(100),
      sourceText: z.string().max(20000),
    })
    .parse(req.body);
  if (body.provider === 'api' && !process.env.OPENAI_API_KEY)
    throw new Error('Configure an API key or connect ChatGPT.');
  if (body.provider === 'chatgpt') await auth.access();
  res
    .status(202)
    .json(
      await pipeline.start(req.params.id, 'analyse', undefined, {
        ...body,
        model: body.provider === 'api' ? uploadConfig.model : body.model,
      }),
    );
});
app.post('/api/projects/:id/provider', async (req, res) => {
  const body = z
    .object({ provider: z.enum(['api', 'chatgpt']), model: z.string().min(1).max(100) })
    .parse(req.body);
  if (body.provider === 'chatgpt') await auth.access();
  if (body.provider === 'api' && !process.env.OPENAI_API_KEY)
    throw new Error('Configure an API key first.');
  res.json(
    await pipeline.provider(
      req.params.id,
      body.provider,
      body.provider === 'api' ? uploadConfig.model : body.model,
    ),
  );
});
app.post('/api/projects/:id/approve', async (req, res) =>
  res.json(await pipeline.approve(req.params.id, analysisSchema.shape.facts.parse(req.body.facts))),
);
app.post('/api/projects/:id/plan', async (req, res) =>
  res
    .status(202)
    .json(await pipeline.start(req.params.id, 'plan', correctionSchema.parse(req.body))),
);
app.post('/api/projects/:id/render', async (req, res) =>
  res.status(202).json(await pipeline.start(req.params.id, 'render')),
);
app.post('/api/auth/start', async (req, res) => {
  const body = z.object({ accountId: z.string().optional() }).parse(req.body);
  res.json({ url: auth.begin(body.accountId) });
});
app.post('/api/auth/select', async (req, res) => {
  await auth.select(z.string().parse(req.body.accountId));
  res.json(auth.status());
});
app.post('/api/auth/disconnect', async (_req, res) => res.json(await auth.disconnect()));
app.get('/api/auth/models', async (_req, res) => res.json(await auth.models()));
app.get('/auth/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    await auth.callback(new URL(req.originalUrl, 'http://127.0.0.1').searchParams);
    res.redirect('/?chatgpt=connected');
  } catch (e) {
    res.redirect('/?chatgpt_error=' + encodeURIComponent((e as Error).message));
  }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use(express.static(path.resolve('dist-upload')));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist-upload/upload.html')));
app.use(
  (
    e: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) =>
    res.status(e instanceof ZodError ? 400 : e.status || 500).json({
      error: e instanceof ZodError ? e.issues.map((i) => i.message).join('; ') : e.message,
    }),
);
const server = app.listen(uploadConfig.port, '127.0.0.1', () =>
  console.log(
    `CUTBACK upload studio: http://127.0.0.1:${uploadConfig.port} · isolated FalkorDB ${uploadConfig.dbPort}`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.close();
    void store.close().finally(() => process.exit(0));
  });
