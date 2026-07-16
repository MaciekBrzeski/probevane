import { readFile, readdir } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';
import { isGeneratedSource } from '../util/generated.js';

// Module dependency graph of src/ — the backbone for mock synthesis (what a
// module depends on) and for chaining (topological order so an upstream
// module's captured output can feed the next). Regex import parse (no TS dep).

export type NodeKind = 'fetcher' | 'hook' | 'component' | 'util';

/** One scanned source module: where it sits, what role it plays, and its
 *  resolved local deps. Filled by buildGraph; consumed by synthesis + render. */
export interface ModuleNode {
  path: string; // project-relative
  kind: NodeKind;
  imports: string[]; // resolved project-relative local imports
  callsNetwork: boolean;
}

/** The scanned repo as a whole: every source module keyed by project-relative
 *  path. Built by buildGraph; the backbone for mock synthesis and chaining. */
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

/** Scan the project (src/ + npm workspaces, or the whole dir for Python) and
 *  build the module graph — regex import parse, so no TS compiler dependency. */
export async function buildGraph(dir: string): Promise<ModuleGraph> {
  // Prefer src/ (JS/TS convention); fall back to the whole dir so Python
  // packages (e.g. pycad/) laid out at the repo root are still graphed.
  const hasSrc = await readdir(join(dir, 'src')).then(() => true).catch(() => false);
  const root = hasSrc ? join(dir, 'src') : dir;
  // npm-workspace packages live OUTSIDE src/ (e.g. a vendored engine/) but are
  // pushed with the repo — scan them too so the graph covers everything, and
  // resolve their package-name imports (`@scope/pkg`) like local ones. When the
  // scan already roots at the whole dir the workspaces are walked anyway.
  const workspaces = hasSrc ? await loadWorkspaces(dir) : [];
  const wsRoots: string[] = [];
  for (const ws of workspaces) {
    const s = join(dir, ws.dir, 'src');
    wsRoots.push(await readdir(s).then(() => s).catch(() => join(dir, ws.dir)));
  }
  const walks = await Promise.all([root, ...wsRoots].map((r) => walk(r).catch(() => [] as string[])));
  const all = walks.flat();
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
    if (isGeneratedSource(src)) continue; // @generated (profiles.gen.ts) — not graphed, not counted
    const imports = IS_PY.test(abs)
      ? resolvePyImports(src, abs, dir, files)
      : [...resolveLocalImports(src, abs, dir, files), ...resolveWorkspaceImports(src, dir, files, workspaces)];
    nodes.set(rel, { path: rel, kind: classify(rel, src), imports, callsNetwork: NET.test(src) });
  }

  return { nodes, order: topoSort(nodes), testFiles };
}

/** One npm-workspace package from the root package.json. Filled by
 *  loadWorkspaces so package-name imports resolve like local ones. */
export interface WorkspacePkg {
  name: string; // package name, e.g. '@facet/core'
  dir: string; // project-relative workspace dir, e.g. 'engine/core'
  main: string; // entry file relative to the workspace dir (package.json main/module, default index)
}

/** Read the root package.json workspace list → named packages. Simple trailing-*
 *  globs (`pkgs/*`) expand one level; non-packages (no package.json name) drop. */
export async function loadWorkspaces(dir: string): Promise<WorkspacePkg[]> {
  const pkg = await readJson(join(dir, 'package.json'));
  const raw = pkg?.workspaces;
  const patterns: string[] = Array.isArray(raw) ? raw : (raw as { packages?: string[] } | undefined)?.packages ?? [];
  const out: WorkspacePkg[] = [];
  for (const pattern of patterns.filter((p) => typeof p === 'string')) {
    for (const wsDir of await expandWorkspacePattern(dir, pattern)) {
      const wpkg = await readJson(join(dir, wsDir, 'package.json'));
      if (typeof wpkg?.name === 'string')
        out.push({ name: wpkg.name, dir: wsDir, main: typeof wpkg.module === 'string' ? wpkg.module : typeof wpkg.main === 'string' ? wpkg.main : 'index' });
    }
  }
  return out;
}

/** Parse a JSON file; null on missing/invalid — workspace scanning must never throw. */
async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `engine/core` → itself; `pkgs/*` → each direct subdir. */
async function expandWorkspacePattern(dir: string, pattern: string): Promise<string[]> {
  if (!pattern.includes('*')) return [pattern];
  const base = pattern.slice(0, pattern.indexOf('*')).replace(/\/$/, '');
  const entries = await readdir(join(dir, base), { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && !SKIP.has(e.name)).map((e) => `${base}/${e.name}`);
}

/** Resolve one workspace-package import spec to a scanned file, or null.
 *  Bare name → the package entry (main/module); `name/sub` → that file. */
function resolvePkgSpec(spec: string, dir: string, files: Set<string>, workspaces: WorkspacePkg[]): string | null {
  const ws = workspaces.find((w) => spec === w.name || spec.startsWith(w.name + '/'));
  if (!ws) return null;
  const sub = spec === ws.name ? ws.main : spec.slice(ws.name.length + 1);
  const base = resolve(dir, ws.dir, sub.replace(/^\.\//, '').replace(/\.js$/, ''));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, join(base, 'index.ts'), join(base, 'index.js')];
  for (const c of candidates) if (files.has(c)) return c;
  return null;
}

/** Workspace-package imports (`@scope/pkg`, `@scope/pkg/sub`) → resolved
 *  project-relative files. Same type-only skips as resolveLocalImports. */
export function resolveWorkspaceImports(src: string, dir: string, files: string[], workspaces: WorkspacePkg[]): string[] {
  if (!workspaces.length) return [];
  const fileSet = new Set(files);
  const out = new Set<string>();
  for (const m of src.matchAll(/import\s+(type\s+)?([^;]*?)from\s+['"]([^'"./][^'"]*)['"]/g)) {
    if (m[1] || typeOnlyMembers(m[2])) continue;
    const hit = resolvePkgSpec(m[3], dir, fileSet, workspaces);
    if (hit) out.add(relative(dir, hit));
  }
  return [...out];
}

/** Bucket a module by role (network call → fetcher, use* name → hook, JSX or
 *  PascalCase export → component, else util) so synthesis knows what to mock. */
function classify(rel: string, src: string): NodeKind {
  if (NET.test(src)) return 'fetcher';
  const base = rel.split('/').pop()!.replace(/\.[tj]sx?$/, '');
  if (/^use[A-Z]/.test(base)) return 'hook';
  if (/\.[tj]sx$/.test(rel) || /export\s+(default\s+)?function\s+[A-Z]/.test(src)) return 'component';
  return 'util';
}

/** `import { type A, type B } from ...` with ONLY type members → no runtime dep. */
function typeOnlyMembers(members: string): boolean {
  return /^\s*\{[^}]*\}\s*$/.test(members) && members.replace(/[{}]/g, '').split(',').every((s) => /^\s*type\s/.test(s));
}

/** Relative JS/TS imports → project-relative scanned files. Type-only imports
 *  are skipped — they carry no runtime dependency worth mocking. */
export function resolveLocalImports(src: string, fromAbs: string, dir: string, files: string[]): string[] {
  const out = new Set<string>();
  // Match whole import statements; skip type-only imports (`import type ...`)
  // and pure type member imports — they carry no runtime dependency to mock.
  for (const m of src.matchAll(/import\s+(type\s+)?([^;]*?)from\s+['"](\.[^'"]+)['"]/g)) {
    if (m[1]) continue; // `import type { X } from ...`
    if (typeOnlyMembers(m[2])) continue;
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

/** DFS topological sort, deps before dependents, cycle edges dropped — the
 *  chaining order so an upstream module's output can feed the next one. */
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

/** Recursive file listing under dir, skipping vendored/generated dirs (SKIP). */
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
