import { readFile, readdir } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';

// Module dependency graph of src/ — the backbone for mock synthesis (what a
// module depends on) and for chaining (topological order so an upstream
// module's captured output can feed the next). Regex import parse (no TS dep).

export type NodeKind = 'fetcher' | 'hook' | 'component' | 'util';

export interface ModuleNode {
  path: string; // project-relative
  kind: NodeKind;
  imports: string[]; // resolved project-relative local imports
  callsNetwork: boolean;
}

export interface ModuleGraph {
  nodes: Map<string, ModuleNode>;
  /** Topological order, leaves (no local deps) first. Cyclic edges are dropped. */
  order: string[];
  /** Source-shaped test files (project-relative), excluded from coupling but kept
   *  so the folder-structure view doesn't read a populated test dir as empty. */
  testFiles: string[];
}

const SKIP = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git',
  '.venv', 'venv', 'env', '.tox', 'site-packages', '__pycache__',
  '.pytest_cache', '.ruff_cache', '.mypy_cache',
]);
const NET = /\b(fetch|axios|XMLHttpRequest|requests\.(get|post|put|delete)|urllib|httpx)\s*[(.]/;
const IS_PY = /\.py$/;
const PY_TEST = /(^|\/)(test_[^/]+|[^/]+_test|conftest)\.py$/;

export async function buildGraph(dir: string): Promise<ModuleGraph> {
  // Prefer src/ (JS/TS convention); fall back to the whole dir so Python
  // packages (e.g. pycad/) laid out at the repo root are still graphed.
  const hasSrc = await readdir(join(dir, 'src')).then(() => true).catch(() => false);
  const root = hasSrc ? join(dir, 'src') : dir;
  const all = await walk(root).catch(() => []);
  const isSource = (f: string) =>
    (/\.(tsx|ts|jsx|js)$/.test(f) && !/main\.[tj]sx?$/.test(f)) || IS_PY.test(f);
  const isTest = (f: string) => /\.(test|spec|d)\.[tj]sx?$/.test(f) || PY_TEST.test(f);
  const files = all.filter((f) => isSource(f) && !isTest(f));
  // Test files are graphed for the FOLDER view only (so a populated tests/ dir
  // isn't mis-read as empty), never for coupling — kept out of `nodes`.
  const testFiles = all.filter((f) => isSource(f) && isTest(f)).map((f) => relative(dir, f));

  const nodes = new Map<string, ModuleNode>();
  for (const abs of files) {
    const rel = relative(dir, abs);
    const src = await readFile(abs, 'utf8').catch(() => '');
    const imports = IS_PY.test(abs)
      ? resolvePyImports(src, abs, dir, files)
      : resolveLocalImports(src, abs, dir, files);
    nodes.set(rel, { path: rel, kind: classify(rel, src), imports, callsNetwork: NET.test(src) });
  }

  return { nodes, order: topoSort(nodes), testFiles };
}

function classify(rel: string, src: string): NodeKind {
  if (NET.test(src)) return 'fetcher';
  const base = rel.split('/').pop()!.replace(/\.[tj]sx?$/, '');
  if (/^use[A-Z]/.test(base)) return 'hook';
  if (/\.[tj]sx$/.test(rel) || /export\s+(default\s+)?function\s+[A-Z]/.test(src)) return 'component';
  return 'util';
}

export function resolveLocalImports(src: string, fromAbs: string, dir: string, files: string[]): string[] {
  const out = new Set<string>();
  // Match whole import statements; skip type-only imports (`import type ...`)
  // and pure type member imports — they carry no runtime dependency to mock.
  for (const m of src.matchAll(/import\s+(type\s+)?([^;]*?)from\s+['"](\.[^'"]+)['"]/g)) {
    if (m[1]) continue; // `import type { X } from ...`
    const members = m[2];
    // `import { type Product } from ...` with ONLY type members → skip
    if (/^\s*\{[^}]*\}\s*$/.test(members) && members.replace(/[{}]/g, '').split(',').every((s) => /^\s*type\s/.test(s)))
      continue;
    const spec = m[3].replace(/\.js$/, '');
    const base = resolve(dirname(fromAbs), spec);
    const hit = files.find((f) => f === base || f.replace(/\.[tj]sx?$/, '') === base || f.replace(/\/index\.[tj]sx?$/, '') === base);
    if (hit) out.add(relative(dir, hit));
  }
  return [...out];
}

/** Resolve a dotted Python module (`a.b.c`) under `baseDir` to a file in `files`
 *  — either `a/b/c.py` or the package `a/b/c/__init__.py`. Null if neither exists. */
function pyModuleToFile(parts: string[], baseDir: string, files: Set<string>): string | null {
  if (!parts.length) return null;
  const p = resolve(baseDir, ...parts);
  for (const c of [p + '.py', join(p, '__init__.py')]) if (files.has(c)) return c;
  return null;
}

const nonNull = (x: string | null): x is string => x !== null;

/** `from a.b import x, y` (and relative `from .mod import x`) → resolved files.
 *  Absolute (level 0) resolves from the project root; each leading dot walks one
 *  dir up from the file's package. Each imported name is also probed as a
 *  submodule (package re-export style). Non-import lines → []. */
function pyFromLine(line: string, fromAbs: string, dir: string, files: Set<string>): string[] {
  const m = line.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$/);
  if (!m) return [];
  const level = m[1].length;
  const modParts = m[2] ? m[2].split('.') : [];
  let base = dir;
  if (level > 0) { base = dirname(fromAbs); for (let i = 1; i < level; i++) base = dirname(base); }
  const names = m[3].replace(/[()]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
  return [
    pyModuleToFile(modParts, base, files),
    ...names.filter((n) => n && n !== '*').map((n) => pyModuleToFile([...modParts, n], base, files)),
  ].filter(nonNull);
}

/** `import a.b, c.d` → resolved files (absolute modules, from the project root). */
function pyImportLine(line: string, dir: string, files: Set<string>): string[] {
  const m = line.match(/^\s*import\s+(.+)$/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((chunk) => chunk.trim().split(/\s+as\s+/)[0].trim())
    .filter((mod) => /^[\w.]+$/.test(mod))
    .map((mod) => pyModuleToFile(mod.split('.'), dir, files))
    .filter(nonNull);
}

/** Local-import resolver for Python: handles `import a.b`, `from a.b import x`,
 *  and relative `from .mod import x` / `from . import mod`. Delegates the two
 *  statement shapes to helpers; this stays a flat scan over the source lines. */
export function resolvePyImports(src: string, fromAbs: string, dir: string, files: string[]): string[] {
  const set = new Set(files);
  const out = new Set<string>();
  for (const line of src.split('\n'))
    for (const hit of [...pyFromLine(line, fromAbs, dir, set), ...pyImportLine(line, dir, set)])
      out.add(relative(dir, hit));
  return [...out];
}

function topoSort(nodes: Map<string, ModuleNode>): string[] {
  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0=unseen 1=onstack 2=done
  const visit = (p: string) => {
    const st = state.get(p);
    if (st === 2 || st === 1) return; // done, or cycle edge → drop
    state.set(p, 1);
    for (const dep of nodes.get(p)?.imports ?? []) if (nodes.has(dep)) visit(dep);
    state.set(p, 2);
    order.push(p);
  };
  for (const p of nodes.keys()) visit(p);
  return order; // deps appear before dependents
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      out.push(...(await walk(join(dir, e.name))));
    } else out.push(join(dir, e.name));
  }
  return out;
}
