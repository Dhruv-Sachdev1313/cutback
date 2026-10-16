import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);
export const ROOT = process.cwd();
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || '.cutback');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const config = {
  graph: process.env.FALKORDB_GRAPH || 'cutback',
  graphHost: process.env.FALKORDB_HOST || '127.0.0.1',
  graphPort: Number(process.env.FALKORDB_PORT || 6387),
  port: Number(process.env.PORT || 4318), host: process.env.HOST || '127.0.0.1',
  model: process.env.OPENAI_MODEL || 'gpt-6-astra',
};
export function agentMode(): 'openai' | 'local' {
  if (process.env.AGENT_MODE === 'local') return 'local';
  if (process.env.AGENT_MODE === 'openai' && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required when AGENT_MODE=openai. Add it to .env and restart.');
  return process.env.OPENAI_API_KEY ? 'openai' : 'local';
}
