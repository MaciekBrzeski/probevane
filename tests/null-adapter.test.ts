import { describe, it, expect } from 'vitest';
import { nullAdapter } from '../src/adapters/null-adapter.js';

// nullAdapter is the no-op StackAdapter for stack-agnostic loop modes (docs): its
// methods must return benign empties and never throw, so a stray rune probe can't
// crash a run.
describe('nullAdapter — no-op stack adapter', () => {
  it('detect never matches (score 0)', async () => {
    expect(await nullAdapter.detect('/nowhere')).toBe(0);
  });

  it('discover / specFiles yield nothing; install is a no-op', async () => {
    expect(await nullAdapter.discover('/x', 'unit')).toEqual([]);
    expect(await nullAdapter.specFiles('/x')).toEqual([]);
    await expect(nullAdapter.install('/x')).resolves.toBeUndefined();
  });

  it('run reports a green empty suite; coverage reports ok:false', async () => {
    expect(await nullAdapter.run('/x', 'unit')).toEqual({ passed: 0, failed: 0, skipped: 0, green: true, raw: '' });
    expect(await nullAdapter.coverage('/x')).toEqual({ statements: 0, branches: 0, functions: 0, lines: 0, ok: false });
  });

  it('probe echoes the target and reports ok', async () => {
    expect(await nullAdapter.probe('/x', 'foo.ts')).toEqual({ target: 'foo.ts', facts: {}, digest: '', ok: true });
  });

  it('commands are all no-op shells; guidance / patternsDoc / auditRules are empty', async () => {
    expect(nullAdapter.commands('/x')).toEqual({ typecheck: 'true', lint: 'true', testUnit: 'true', testE2e: 'true', coverage: 'true' });
    expect(nullAdapter.guidance('unit')).toBe('');
    expect(await nullAdapter.patternsDoc('/x')).toBe('');
    expect(nullAdapter.auditRules()).toEqual([]);
  });
});
