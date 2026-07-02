import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunScope } from '../src/adapters/adapter.js';

// --- temp dir bookkeeping (same helpers as cov-mut-adapters.test.ts) -------
const dirs: string[] = [];
function tmp(prefix = 'pv-covmut-rust-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

// run() calls the module-level `sh` from ../../util/exec.js and parses its
// stdout+stderr — no real cargo needed. We vi.doMock the exec module to feed a
// canned `cargo test` report string, exactly like the go-test / angular tests.

// =========================================================================
// rust-cargo/index.ts:60,61,62,68 — the run() parse path.
//   :60 matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)  (+ → -
//       corrupts the \d+ quantifiers → nothing matches → counts stay 0)
//   :61 passed += parseInt(m[1],10)   (+= → -=)
//   :62 failed += parseInt(m[2],10)   (+= → -=)
//   :68 green: r.ok && failed === 0 && passed > 0   (=== → !==, && → ||)
// =========================================================================
describe('rustAdapter.run — parses cargo test report (kills :60/:61/:62/:68)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/util/exec.js');
  });

  it('sums passed/failed across result lines; all-pass is green', async () => {
    // Two "test result" lines (unit lib + one integration test file) exercise
    // the += accumulation, not just a single assignment.
    const stdout = [
      'test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s',
      'test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
    ].join('\n');
    vi.resetModules();
    vi.doMock('../src/util/exec.js', () => ({
      sh: async () => ({ ok: true, code: 0, stdout, stderr: '' }),
      capOutput: (s: string) => s,
    }));
    const { rustAdapter } = await import('../src/adapters/rust-cargo/index.js');
    const r = await rustAdapter.run(tmp(), {} as RunScope);
    // :60 regex must match; :61 must ADD (mutant -= → -5). :62 stays 0.
    expect(r.passed).toBe(5); // mutant += → -=  yields -5
    expect(r.failed).toBe(0);
    // :68 all conditions true → green true.
    expect(r.green).toBe(true);
  });

  it('a failing suite (r.ok true, failed>0) is NOT green', async () => {
    // r.ok stays true so green is decided purely by the parsed counts — this is
    // what discriminates :68 `===`→`!==` (would flip to true) and `&&`→`||`
    // (would be true because r.ok is true).
    const stdout = 'test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s';
    vi.resetModules();
    vi.doMock('../src/util/exec.js', () => ({
      sh: async () => ({ ok: true, code: 0, stdout, stderr: '' }),
      capOutput: (s: string) => s,
    }));
    const { rustAdapter } = await import('../src/adapters/rust-cargo/index.js');
    const r = await rustAdapter.run(tmp(), {} as RunScope);
    expect(r.passed).toBe(2); // :60 regex matches, :61 += → 2 (mutant -= → -2)
    expect(r.failed).toBe(1); // :62 += → 1 (mutant -= → -1)
    expect(r.green).toBe(false); // :68 failed===0 false → green false
  });
});

// =========================================================================
// parseLlvmCovSummary — cargo-llvm-cov JSON totals → CoverageResult
// =========================================================================
import { parseLlvmCovSummary } from '../src/adapters/rust-cargo/index.js';

describe('parseLlvmCovSummary', () => {
  it('maps totals percentages (rounded to 2dp)', () => {
    const j = JSON.stringify({
      data: [{ totals: {
        lines: { percent: 91.6667 },
        functions: { percent: 100 },
        regions: { percent: 88.4615 },
        branches: { percent: 0 },
      } }],
    });
    const c = parseLlvmCovSummary(j);
    expect(c.ok).toBe(true);
    expect(c.lines).toBe(91.67);
    expect(c.functions).toBe(100);
    expect(c.statements).toBe(88.46);
    expect(c.branches).toBe(0);
  });

  it('missing branches key reads as 0, still ok', () => {
    const j = JSON.stringify({ data: [{ totals: { lines: { percent: 50 } } }] });
    const c = parseLlvmCovSummary(j);
    expect(c.ok).toBe(true);
    expect(c.lines).toBe(50);
    expect(c.branches).toBe(0);
  });

  it('malformed JSON → ok:false', () => {
    expect(parseLlvmCovSummary('not json').ok).toBe(false);
  });

  it('valid JSON without totals → ok:false', () => {
    expect(parseLlvmCovSummary('{"data":[]}').ok).toBe(false);
  });
});
