import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from './config.js';
import { GraphStore } from './store.js';
import { correctionSchema, evidenceSchema, changedFields } from './story.js';
const store = await GraphStore.connect();
const server = new McpServer({ name: 'cutback', version: '0.1.0' });
const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});
server.registerTool(
  'get_current_cut',
  { description: 'Read CUTBACK’s current video and its evidence from FalkorDB.', inputSchema: {} },
  async () => result(await store.latest()),
);
server.registerTool(
  'trace_source_change',
  {
    description: 'Trace the exact graph paths a proposed source correction would invalidate.',
    inputSchema: evidenceSchema.shape,
  },
  async (evidence) => {
    const previous = await store.latest();
    return result(
      await store.impact(
        previous ? changedFields(previous.evidence, evidence) : Object.keys(evidence),
      ),
    );
  },
);
server.registerTool(
  'get_scene_provenance',
  {
    description: 'Read a scene’s evidence paths and immutable source snapshot for a specific cut.',
    inputSchema: {
      versionId: z.string(),
      sceneId: z.enum(['opening', 'cost', 'verdict', 'outro']),
    },
  },
  async ({ versionId, sceneId }) => {
    const version = (await store.versions()).find((v) => v.id === versionId);
    if (!version) throw new Error('Version not found.');
    return result({
      evidence: version.evidence,
      sourceNote: version.sourceNote,
      paths: await store.provenance(sceneId),
    });
  },
);
server.registerTool(
  'apply_source_correction',
  {
    description:
      'Start a verified video revision. The local CUTBACK API must be running. Uses optimistic revision locking.',
    inputSchema: correctionSchema.shape,
  },
  async (body) => {
    const response = await fetch('http://127.0.0.1:' + config.port + '/api/revisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return result(data);
  },
);
await server.connect(new StdioServerTransport());
process.on('SIGINT', async () => {
  await server.close();
  await store.close();
  process.exit(0);
});
