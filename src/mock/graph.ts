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
}

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const NET = /\b(fetch|axios|XMLHttpRequest)\s*[(.]/;

export async function buildGraph(dir: string): Promise<ModuleGraph> {
  const root = join(dir, 'src');
  const files = (await walk(root).catch(() => [])).filter(
    (f) => /\.(tsx|ts|jsx|js)$/.test(f) && !/\.(test|spec|d)\.[tj]sx?$/.test(f) && !/main\.[tj]sx?$/.test(f),
  );

  const nodes = new Map<string, ModuleNode>();
  for (const abs of files) {
    const rel = relative(dir, abs);
    const src = await readFile(abs, 'utf8').catch(() => '');
    const imports = resolveLocalImports(src, abs, dir, files);
    nodes.set(rel, { path: rel, kind: classify(rel, src), imports, callsNetwork: NET.test(src) });
  }

  return { nodes, order: topoSort(nodes) };
}

function classify(rel: string, src: string): NodeKind {
  if (NET.test(src)) return 'fetcher';
  const base = rel.split('/').pop()!.replace(/\.[tj]sx?$/, '');
  if (/^use[A-Z]/.test(base)) return 'hook';
  if (/\.[tj]sx$/.test(rel) || /export\s+(default\s+)?function\s+[A-Z]/.test(src)) return 'component';
  return 'util';
}

function resolveLocalImports(src: string, fromAbs: string, dir: string, files: string[]): string[] {
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
