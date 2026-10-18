import fs from 'node:fs/promises';
import path from 'node:path';
import { uploadConfig } from './config.js';
export class Budget {
  private used = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private file = path.join(uploadConfig.root, 'api-budget.json'),
    private allowance = uploadConfig.budget,
  ) {}
  async initialize() {
    try {
      this.used = Number(JSON.parse(await fs.readFile(this.file, 'utf8')).used);
      if (!Number.isFinite(this.used) || this.used < 0)
        throw new Error('Invalid API budget ledger.');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  status() {
    return {
      allowance: this.allowance,
      used: this.used,
      remaining: Math.max(0, this.allowance - this.used),
    };
  }
  private serial<T>(fn: () => Promise<T>) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async reserve(amount: number) {
    return this.serial(async () => {
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid cost reservation.');
      if (this.used + amount > this.allowance)
        throw new Error(
          'This branch’s API allowance would be exceeded. Use ChatGPT or increase UPLOAD_API_BUDGET_USD explicitly.',
        );
      this.used += amount;
      await this.save();
      return amount;
    });
  }
  async settle(reserved: number, measured: number) {
    return this.serial(async () => {
      if (![reserved, measured].every((n) => Number.isFinite(n) && n >= 0))
        throw new Error('Invalid cost settlement.');
      this.used = Math.max(0, this.used - reserved + measured);
      await this.save();
    });
  }
  private async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.writeFile(
      tmp,
      JSON.stringify({ used: this.used, updatedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    await fs.rename(tmp, this.file);
  }
}
