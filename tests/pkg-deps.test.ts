import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPackageDeps } from '../src/adapters/pkg-deps.js';

function withPkg(pkg: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'pv-pkg-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

describe('readPackageDeps', () => {
  it('merges dependencies + devDependencies', async () => {
    const dir = withPkg({ dependencies: { react: '^18' }, devDependencies: { vitest: '^2' } });
    expect(await readPackageDeps(dir)).toEqual({ react: '^18', vitest: '^2' });
  });

  it('devDependencies win on a name conflict (spread order)', async () => {
    const dir = withPkg({ dependencies: { typescript: '5.0' }, devDependencies: { typescript: '5.4' } });
    expect((await readPackageDeps(dir)).typescript).toBe('5.4');
  });

  it('returns {} when package.json is missing or unparsable', async () => {
    const missing = mkdtempSync(join(tmpdir(), 'pv-pkg-none-'));
    expect(await readPackageDeps(missing)).toEqual({});
    const bad = mkdtempSync(join(tmpdir(), 'pv-pkg-bad-'));
    writeFileSync(join(bad, 'package.json'), '{ not json');
    expect(await readPackageDeps(bad)).toEqual({});
  });
});
