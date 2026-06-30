import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { workspaceRootOf } from './tools.js';
import { astExtract } from '../adapters/ast-probe.js';

// Dependency-API digest for `--only` runs. The workspace-read fix LETS the model
// read sibling packages; this REMOVES the need — it parses the focus file's
// imports, resolves the workspace packages + relative modules they point at, and
// injects their public export signatures up front. Fewer reads, less thrash, and
// no wrong-guessed shapes (the Biome.color failure). Best-effort + bounded; pure
// over the filesystem.

const MAX_MODULES = 8;
const MAX_SYMBOLS = 25;
const MAX_CHARS = 3500;

/** The `workspaces` globs from the root manifest ([] on missing/parse error). */
function readWorkspaceGlobs(rootPkgPath: string): string[] {
  try {
    const j = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
    return Array.isArray(j.workspaces) ? j.workspaces : j.workspaces?.packages ?? [];
  } catch { return []; }
}

/** Expand workspace globs to concrete member directories (abs). */
function memberDirsOf(root: string, globs: string[]): string[] {
  const dirs: string[] = [];
  for (const g of globs) {
    if (g.includes('*')) {
      const prefix = g.slice(0, g.indexOf('*')).replace(/\/$/, '');
      const base = join(root, prefix);
      try {
        for (const e of readdirSync(base, { withFileTypes: true })) if (e.isDirectory()) dirs.push(join(base, e.name));
      } catch { /* missing glob dir */ }
    } else dirs.push(join(root, g));
  }
  return dirs;
}

/** Read one member package.json and register name -> entry source file. */
function addPackage(out: Map<string, string>, dir: string): void {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return;
  try {
    const j = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (!j.name) return;
    const entry = entryOf(j);
    const abs = resolveModule(join(dir, entry));
    if (abs) out.set(j.name, abs);
  } catch { /* skip */ }
}

/** Map workspace package name -> entry source file (abs), from the root manifest. */
function workspacePackages(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const rootPkgPath = join(root, 'package.json');
  if (!existsSync(rootPkgPath)) return out;
  const globs = readWorkspaceGlobs(rootPkgPath);
  for (const dir of memberDirsOf(root, globs)) addPackage(out, dir);
  return out;
}

function entryOf(pkg: Record<string, unknown>): string {
  const exp = pkg.exports as undefined | string | Record<string, unknown>;
  const dot = exp && typeof exp === 'object' ? (exp['.'] as undefined | string | Record<string, string>) : undefined;
  const fromExports = typeof exp === 'string' ? exp : typeof dot === 'string' ? dot : dot?.import ?? dot?.default;
  return (fromExports as string) || (pkg.module as string) || (pkg.main as string) || 'src/index.ts';
}

/** Resolve a path to a concrete source file (try extensions + /index). */
function resolveModule(p: string): string | null {
  const cands = [
    p, p + '.ts', p + '.tsx', p + '.js', p + '.jsx',
    join(p, 'index.ts'), join(p, 'index.tsx'), join(p, 'index.js'),
  ];
  for (const c of cands) { try { if (statSync(c).isFile()) return c; } catch { /* next */ } }
  return null;
}

/** Import specifiers in a source file (bare + relative; type-only skipped). */
function importSpecs(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    if (!m[1]) out.add(m[2]);
  }
  for (const m of src.matchAll(/import\s+['"]([^'"]+)['"]/g)) out.add(m[1]);
  return [...out];
}

/** Public symbols (name + signature when directly defined) of a module source. */
function moduleApi(src: string): string[] {
  const out = new Map<string, string | undefined>();
  const facts = astExtract(src, 'm.tsx');
  if (facts) for (const e of facts.exports) out.set(e.name, e.signature);
  // Re-export barrels (astExtract with noResolve misses these): pull the names.
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, '');
      if (name) out.set(name, out.get(name));
    }
  }
  return [...out.entries()].slice(0, MAX_SYMBOLS).map(([name, sig]) => (sig ? sig : name));
}

/** Resolve an import specifier (relative OR workspace package) to a source file. */
function resolveImportToFile(spec: string, abs: string, pkgs: Map<string, string>): string | null {
  if (spec.startsWith('.')) return resolveModule(resolve(dirname(abs), spec));
  // workspace package: exact name or name + subpath
  const name = pkgs.has(spec) ? spec : [...pkgs.keys()].find((n) => spec === n || spec.startsWith(n + '/'));
  if (!name) return null;
  return spec === name ? pkgs.get(name)! : resolveModule(join(dirname(pkgs.get(name)!), spec.slice(name.length + 1)));
}

/** Resolve one import spec to its module file + a digest line, or null (skip). */
function depLine(
  spec: string,
  abs: string,
  pkgs: Map<string, string>,
  root: string,
): { modAbs: string; line: string } | null {
  const modAbs = resolveImportToFile(spec, abs, pkgs);
  if (!modAbs) return null;
  let api: string[];
  try { api = moduleApi(readFileSync(modAbs, 'utf8')); } catch { return null; }
  if (!api.length) return null;
  const rel = relative(root, modAbs);
  return { modAbs, line: `  from '${spec}' (${rel}): ${api.join('; ')}` };
}

/** Build the dependency-API context block for a focus file (empty if nothing useful). */
export function buildDepDigest(dir: string, onlyPath: string): string {
  const abs = resolveModule(resolve(dir, onlyPath));
  if (!abs) return '';
  let src: string;
  try { src = readFileSync(abs, 'utf8'); } catch { return ''; }

  const root = workspaceRootOf(dir);
  const pkgs = workspacePackages(root);
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const spec of importSpecs(src)) {
    if (lines.length >= MAX_MODULES) break;
    const r = depLine(spec, abs, pkgs, root);
    if (!r || seen.has(r.modAbs)) continue;
    seen.add(r.modAbs);
    lines.push(r.line);
  }

  if (!lines.length) return '';
  let block =
    `\n\nDEPENDENCY APIs (already imported by ${onlyPath} — call these directly; ` +
    `no need to read their source):\n${lines.join('\n')}`;
  if (block.length > MAX_CHARS) block = block.slice(0, MAX_CHARS) + '\n  …(truncated)';
  return block;
}
