import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Budget } from '../server/upload/budget.js';

test('concurrent requests cannot reserve more than the persisted API allowance', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cutback-budget-'));
  const file = path.join(dir, 'ledger.json');
  try {
    const budget = new Budget(file, 1);
    await budget.initialize();
    const results = await Promise.allSettled([budget.reserve(0.7), budget.reserve(0.7)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(budget.status().used, 0.7);
    const restarted = new Budget(file, 1);
    await restarted.initialize();
    await assert.rejects(restarted.reserve(0.4), /allowance/);
    await restarted.settle(0.7, 0.04);
    assert.ok(Math.abs(restarted.status().used - 0.04) < 1e-9);
    await assert.rejects(restarted.reserve(NaN), /Invalid/);
    await assert.rejects(restarted.settle(0, -1), /Invalid/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a corrupted allowance ledger fails closed instead of resetting spending', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cutback-budget-'));
  try {
    const file = path.join(dir, 'ledger.json');
    await fs.writeFile(file, '{"used":"invalid"}');
    await assert.rejects(new Budget(file, 1).initialize(), /Invalid/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
