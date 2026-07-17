import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADAPTERS, selectAdapter, selectAdapterOrThrow } from '../src/adapters/registry.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

describe('adapter registry — selectAdapter', () => {
  it('registers every known adapter with a unique id', () => {
    expect(ADAPTERS.length).toBeGreaterThan(0);
    const ids = ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('picks a matching adapter for a real project', async () => {
    const a = await selectAdapter(join(FIXTURES, 'node-calc'));
    expect(a).not.toBeNull();
    expect(a!.id).toMatch(/node/); // node-calc → the node-vitest adapter
  });

  it('returns null when no adapter matches (empty dir)', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'pv-noadapter-'));
    expect(await selectAdapter(empty)).toBeNull();
  });

  it('selectAdapterOrThrow throws a naming error on a miss', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'pv-noadapter2-'));
    await expect(selectAdapterOrThrow(empty)).rejects.toThrow(/no adapter matched/);
  });
});
