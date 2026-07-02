import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeAdapter } from '../src/adapters/node-vitest/index.js';

// --- temp dir bookkeeping (same helpers as cov-adapters*.test.ts) ---------
const dirs: string[] = [];
function tmp(prefix = 'pv-covmut-node-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function write(dir: string, rel: string, contents: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

// A package.json that ALREADY has vitest so install() skips the npm install
// branch (no network) and proceeds straight to the exists()-gated config step.
const PKG = JSON.stringify({ devDependencies: { vitest: '2' } });

// exists() (index.ts:24) is used ONLY by install() (index.ts:46) — detect()
// reads package.json deps and never calls it — so both mutants are killed by
// observing install()'s config-writing behavior, not detect().

// =========================================================================
// MUTANT — node-vitest/index.ts:24
//   const exists = (p) => access(p).then(() => true).catch(() => false)
//   mutant: `true` -> `false`  (exists() ALWAYS returns false)
// A vitest.config.mts is ALREADY present. Baseline: exists(.mts) === true, so
//   !(exists .ts) && !(exists .mts) = true && false = false  -> install leaves
//   the existing config untouched (its marker survives).
// With the mutant exists() is always false, the guard becomes true && true and
//   install OVERWRITES vitest.config.mts with the default -> the marker is gone.
// =========================================================================
describe('nodeAdapter.install — a present config survives (kills exists true -> false)', () => {
  it('does not clobber an existing vitest.config.mts', async () => {
    const d = tmp();
    write(d, 'package.json', PKG);
    const marker = '// MARKER-KEEP-THIS-CONFIG\nexport default {};\n';
    write(d, 'vitest.config.mts', marker);

    await nodeAdapter.install(d);

    // Baseline: exists(.mts)===true short-circuits the && guard -> no write.
    // Mutant (exists always false): guard is true -> default config written,
    // clobbering the marker.
    const after = readFileSync(join(d, 'vitest.config.mts'), 'utf8');
    expect(after).toContain('MARKER-KEEP-THIS-CONFIG'); // mutant overwrites -> gone
    expect(after).not.toContain('defineConfig'); // the default config would add this
  });
});

// =========================================================================
// MUTANT — node-vitest/index.ts:46
//   if (!(await exists('vitest.config.ts')) && !(await exists('vitest.config.mts')))
//   mutant: `&&` -> `||`
// Contrast the "exactly one config present" case against the "none present"
// case. install() only ever WRITES vitest.config.mts, so we observe whether it
// gets created.
//   * none present: !(false) && !(false) = true -> mts IS created (baseline).
//   * only vitest.config.ts present: !(true) && !(false) = false && true = false
//       -> baseline does NOT create mts.
//       with `||`: false || true = true -> mts IS created (the flip).
// The negated-AND branch flips exactly here, so the one-present case kills it.
// =========================================================================
describe('nodeAdapter.install — one config present suppresses the write (kills && -> ||)', () => {
  it('with NO config present, install creates vitest.config.mts (baseline contrast)', async () => {
    const d = tmp();
    write(d, 'package.json', PKG);

    await nodeAdapter.install(d);

    // true && true -> writes; unaffected by the mutant, establishes the contrast.
    expect(existsSync(join(d, 'vitest.config.mts'))).toBe(true);
  });

  it('with vitest.config.ts already present, install does NOT create vitest.config.mts', async () => {
    const d = tmp();
    write(d, 'package.json', PKG);
    write(d, 'vitest.config.ts', 'export default {};\n'); // the ONE config present

    await nodeAdapter.install(d);

    // Baseline (&&): !(exists .ts)=false short-circuits -> no mts written.
    // Mutant (||): false || !(exists .mts)=true -> mts written -> this flips.
    expect(existsSync(join(d, 'vitest.config.mts'))).toBe(false);
    // the pre-existing .ts config is left alone either way
    expect(readFileSync(join(d, 'vitest.config.ts'), 'utf8')).toContain('export default {}');
  });
});
