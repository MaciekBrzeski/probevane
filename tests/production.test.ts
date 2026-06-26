import { describe, it, expect } from 'vitest';
import { appendFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateRoot, statePath } from '../src/util/state.js';
import { appendJsonl, readJsonl } from '../src/util/jsonl.js';

// ---- Phase 1: state isolation -----------------------------------------------
describe('stateRoot', () => {
  it('honors PROBEVANE_STATE for isolation', () => {
    const old = process.env.PROBEVANE_STATE;
    process.env.PROBEVANE_STATE = '/tmp/pv-iso';
    try {
      expect(stateRoot()).toBe('/tmp/pv-iso');
      expect(statePath('traces', 'traces.jsonl')).toBe('/tmp/pv-iso/traces/traces.jsonl');
    } finally {
      if (old === undefined) delete process.env.PROBEVANE_STATE; else process.env.PROBEVANE_STATE = old;
    }
  });
  it('defaults under home when unset', () => {
    const old = process.env.PROBEVANE_STATE;
    delete process.env.PROBEVANE_STATE;
    try {
      expect(stateRoot()).toMatch(/\.local[/\\]share[/\\]probevane$/);
    } finally {
      if (old !== undefined) process.env.PROBEVANE_STATE = old;
    }
  });
});

// ---- Phase 1: atomic JSONL --------------------------------------------------
describe('appendJsonl', () => {
  it('serializes concurrent appends — no torn or lost lines', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'pv-jsonl-')), 'x.jsonl');
    await Promise.all(Array.from({ length: 50 }, (_, i) => appendJsonl(p, { i, pad: 'x'.repeat(300) })));
    const rows = await readJsonl<{ i: number }>(p);
    expect(rows).toHaveLength(50);
    expect(new Set(rows.map((r) => r.i)).size).toBe(50);
  });
  it('readJsonl skips a malformed line (torn-write defense)', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'pv-jsonl-')), 'y.jsonl');
    await appendJsonl(p, { a: 1 });
    await appendFile(p, '{ not valid json\n');
    await appendJsonl(p, { a: 2 });
    expect((await readJsonl<{ a: number }>(p)).map((r) => r.a)).toEqual([1, 2]);
  });
});
