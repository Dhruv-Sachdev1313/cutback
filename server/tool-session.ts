import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FunctionTool } from 'openai/resources/responses/responses';
import { z } from 'zod';
import { planSchema } from './story.js';

// An actual MCP client/server pair, scoped to one revision. In-memory transport
// avoids spawning a subprocess while retaining discovery and JSON-RPC validation.
export async function createToolSession(
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const server = new McpServer({ name: 'cutback-editorial-tools', version: '0.1.0' });
  const definitions: { name: string; description: string; schema: z.ZodRawShape }[] = [
    {
      name: 'trace_impact',
      description:
        'Traverse FalkorDB from changed facts to affected scenes. Returns exact dependency paths. Call before editing.',
      schema: {},
    },
    {
      name: 'calculate_costs',
      description:
        'Read candidate facts from FalkorDB and compute authoritative total upfront costs in integer cents.',
      schema: {},
    },
    {
      name: 'read_scene',
      description: 'Read the existing scene and its evidence paths before editing.',
      schema: { sceneId: z.enum(['opening', 'cost', 'verdict', 'outro']) },
    },
    {
      name: 'submit_edit_plan',
      description:
        'Submit exactly the graph-affected scenes, after reading them and calculating costs. Framing must match the computed result. Factual narration is compiled from verified facts.',
      schema: planSchema.shape,
    },
  ];
  for (const def of definitions)
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.schema },
      async (args) => ({
        content: [{ type: 'text', text: JSON.stringify(await execute(def.name, args)) }],
      }),
    );
  const client = new Client({ name: 'cutback-editor', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const discovered = await client.listTools();
  const tools: FunctionTool[] = discovered.tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: { ...t.inputSchema, additionalProperties: false },
    strict: true,
  }));
  return {
    tools,
    async call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text?: string }[];
      const text = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      if (result.isError) throw new Error(text);
      return JSON.parse(text) as unknown;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
