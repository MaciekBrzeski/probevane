import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { TestKind, TestTarget } from '../adapter.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'e2e', 'tests', '__tests__']);

// Files that are never worth a unit/e2e target: non-source, test/decl files, and
// app entry/bootstrap modules.
function isSkippable(f: string): boolean {
  if (!/\.(tsx|ts|jsx|js)$/.test(f)) return true;
  if (/\.(test|spec|d)\.[tj]sx?$/.test(f)) return true;
  if (/(^|\/)(main|index|vite-env|setupTests|reportWebVitals)\.[tj]sx?$/.test(f)) return true;
  return false;
}

// Lower cost = easier to test in isolation. Components and store/router-bound
// modules cost more (provider scaffolding); pure helpers, types, and slices less.
function testCost(src: string, rel: string, isComponent: boolean): number {
  let cost = 0;
  if (isComponent) cost += 3;
  if (/use(Selector|Dispatch|Store)|connect\(/.test(src)) cost += 3; // redux-bound
  if (/use(Navigate|Params|Location|History)|<(Route|Link|NavLink)\b/.test(src)) cost += 2; // router-bound
  if (/useContext|createContext/.test(src)) cost += 1;
  if (/createSlice|createReducer|^export (const|function) \w+ =/m.test(src)) cost -= 1; // pure-ish
  if (/(^|\/)types\//.test(rel) || /\.slice\.[tj]s$/.test(rel)) cost -= 1; // types & slices: easy
  return cost;
}

/** Walk src/ for files worth testing, RANKED by testability (easiest first) so
 *  that `--max-targets` on a big app picks the winnable modules — pure helpers,
 *  types, redux slices, hooks — before heavy components that need provider
 *  scaffolding (Redux store / Router / Context). */
export async function discoverReact(dir: string, kind: TestKind): Promise<TestTarget[]> {
  const root = join(dir, 'src');
  const files = await walk(root).catch(() => [] as string[]);
  const scored: { t: TestTarget; cost: number }[] = [];
  for (const f of files) {
    if (isSkippable(f)) continue;
    const rel = relative(dir, f);
    const src = await readFile(f, 'utf8').catch(() => '');
    const isComponent = /\.[tj]sx$/.test(f) || /export\s+(default\s+)?function\s+[A-Z]/.test(src);
    if (kind === 'e2e' && !isComponent) continue;

    const cost = testCost(src, rel, isComponent);
    scored.push({ t: { kind, sourcePath: rel, name: baseName(f), meta: { isComponent, cost } }, cost });
  }
  scored.sort((a, b) => a.cost - b.cost);
  return scored.map((s) => s.t);
}

// Recursive file listing under src/, skipping build/test dirs.
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...(await walk(join(dir, e.name))));
    } else {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

// File name minus dir + JS/TS extension — becomes the target's display name.
function baseName(f: string): string {
  return f.split('/').pop()!.replace(/\.[tj]sx?$/, '');
}
