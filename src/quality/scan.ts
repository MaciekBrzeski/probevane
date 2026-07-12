import { join, relative } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { analyzeProject, DEFAULT_QUALITY, type QualityConfig, type QualityReport } from './analyze.js';
import { detectPythonFunctions } from './py-detect.js';

// I/O wrapper around the pure analyzer: walk a project's source tree, read the files,
// and analyze. Shared by the `quality` CLI and the daemon's /quality. Vendored /
// virtual-env / cache dirs are skipped so we never grade a dependency's bundled code
// (e.g. torch shipping a .js inside .venv).
const SKIP = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.probevane',
  '.venv', 'venv', 'env', '.tox', 'site-packages', '__pycache__',
  '.pytest_cache', '.ruff_cache', '.mypy_cache', '.hg', '.svn', '.idea', '.vscode',
]);
const SRC = /\.(tsx|ts|jsx|js|py)$/;
const TEST = /\.(test|spec|d)\.[tj]sx?$/;
const PY_TEST = /(^|\/)(test_[^/]+|[^/]+_test|conftest)\.py$/;
const IS_PY = /\.py$/;

/** Recursively collect file paths under dir, pruning SKIP dirs; unreadable
 *  dirs read as empty so a bad entry can't fail the whole scan. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) out.push(...(await walk(join(dir, e.name))));
    } else out.push(join(dir, e.name));
  }
  return out;
}

/** Narrow walked paths to a changed subset (`--since`); undefined keeps all. */
export function selectInputPaths(allPaths: string[], changed?: string[]): string[] {
  if (!changed) return allPaths;
  const set = new Set(changed);
  return allPaths.filter((p) => set.has(p));
}

/** The I/O entry point (CLI + daemon): walk the tree (preferring src/), read
 *  non-test sources, attach Python metrics from the subprocess detector, and
 *  run the pure analyzer. */
export async function scanProject(
  dir: string,
  cfg: QualityConfig = DEFAULT_QUALITY,
  only?: string[],
): Promise<QualityReport> {
  const srcRoot = (await stat(join(dir, 'src')).then((s) => s.isDirectory()).catch(() => false))
    ? join(dir, 'src')
    : dir;
  const files = (await walk(srcRoot)).filter(
    (f) => SRC.test(f) && !TEST.test(f) && !PY_TEST.test(f),
  );
  const keep = new Set(selectInputPaths(files.map((f) => relative(dir, f)), only));
  const inputs = await Promise.all(
    files
      .filter((f) => keep.has(relative(dir, f)))
      .map(async (f) => ({ file: relative(dir, f), source: await readFile(f, 'utf8').catch(() => '') })),
  );
  // Python files: get per-function metrics from the ast-based detector (subprocess),
  // then attach them so analyzeProject uses them instead of the TS/JS parser.
  const pyInputs = inputs.filter((x) => IS_PY.test(x.file));
  const pyFns = pyInputs.length ? await detectPythonFunctions(pyInputs) : null;
  const enriched = inputs.map((x) =>
    pyFns && IS_PY.test(x.file) ? { ...x, functions: pyFns.get(x.file) ?? [] } : x,
  );
  return analyzeProject(enriched, cfg);
}
