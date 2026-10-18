import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve('.env.upload'), quiet: true } as dotenv.DotenvConfigOptions);
export const uploadConfig = {
  port: Number(process.env.UPLOAD_PORT || 4328),
  dbPort: Number(process.env.UPLOAD_DB_PORT || 6397),
  root: path.resolve('.cutback-upload'),
  media: path.resolve('.cutback-upload/media'),
  model: 'gpt-6.1-sol',
  budget: Number(process.env.UPLOAD_API_BUDGET_USD || 1),
  maxSeconds: 120,
};
// A mistaken copied .env must never make this process share the original demo.
if ([4317, 4318].includes(uploadConfig.port) || [6379, 6387].includes(uploadConfig.dbPort))
  throw new Error('The upload branch requires its own application and database ports.');
if (!Number.isFinite(uploadConfig.budget) || uploadConfig.budget <= 0 || uploadConfig.budget > 5)
  throw new Error('UPLOAD_API_BUDGET_USD must be greater than zero and at most $5.');
export const urlFor = (relative: string) => '/uploads/' + relative.split(path.sep).join('/');
export function fileFor(url: string) {
  if (!url.startsWith('/uploads/')) throw new Error('Invalid media path.');
  const file = path.resolve(uploadConfig.media, url.slice(9));
  if (!file.startsWith(uploadConfig.media + path.sep)) throw new Error('Invalid media path.');
  return file;
}
