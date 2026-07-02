import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { dueForCycle, pickBetter, readModelPointer, writeModelPointer, type EvalResult } from '../src/distill/improve.js';

describe('dueForCycle', () => {
  it('fires once accepts reach the threshold', () => {
    expect(dueForCycle(9, 10)).toBe(false);
    expect(dueForCycle(10, 10)).toBe(true);
    expect(dueForCycle(50, 0)).toBe(false); // disabled
  });
});

describe('pickBetter', () => {
  const m = (model: string, acceptRate: number, cost?: number): EvalResult => ({ model, acceptRate, cost });
  it('higher acceptance wins', () => {
    expect(pickBetter(m('a', 0.6), m('b', 0.8)).model).toBe('b');
  });
  it('ties break on lower cost', () => {
    expect(pickBetter(m('a', 0.8, 0.2), m('b', 0.8, 0.1)).model).toBe('b');
  });
  it('full tie keeps the incumbent (a)', () => {
    expect(pickBetter(m('a', 0.8, 0.1), m('b', 0.8, 0.1)).model).toBe('a');
  });
});

describe('model pointer round-trip', () => {
  it('writes + reads the promoted model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-imp-'));
    const path = join(dir, 'model.json');
    expect(await readModelPointer(path)).toBeUndefined();
    await writeModelPointer('local:probe-lora', 'compare win', path);
    expect(await readModelPointer(path)).toBe('local:probe-lora');
  });
});
