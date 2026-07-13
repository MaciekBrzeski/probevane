import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { detectFunctionDocs } from '../../quality/detect-docs.js';
import { embedIndex, type Indexed, type IndexOpts } from './index.js';

// Function-level similarity: embed each documented function's DOC COMMENT and
// rank pairs — functions whose docs say the same thing are merge/consolidation
// candidates (e.g. N near-identical `walk()` helpers whose bodies differ enough
// to slip past the textual duplication detector). The doc-comment quality rule
// guarantees coverage, which is what makes this comparison meaningful.
// Report-only; the caller (search --similar --fns) prints candidates to judge.

// A doc shorter than this says nothing distinctive ("helper") and would pair
// with everything; `main` is excluded because CLI shells all doc alike by design.
const MIN_DOC = 20;
const SKIP_NAMES = new Set(['main']);

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.probevane',
  '.venv', 'venv', 'env', '.tox', 'site-packages', '__pycache__',
  '.pytest_cache', '.ruff_cache', '.mypy_cache', '.hg', '.svn', '.idea', '.vscode',
]);
const TS_SRC = /\.(tsx|ts|jsx|js)$/;
const TEST = /\.(test|spec|d)\.[tj]sx?$/;

/** Recursively collect file paths, pruning vendored/cache dirs (same set the
 *  quality scanner prunes); unreadable dirs read as empty. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...(await walk(join(dir, e.name))));
    } else out.push(join(dir, e.name));
  }
  return out;
}

/** One embeddable function: display path (`file:line name()`) + the text that
 *  gets embedded (name + doc prose — the file path is deliberately EXCLUDED so
 *  same-dir functions aren't inflated by path similarity). */
interface FnText {
  path: string;
  text: string;
}

/** Every documented TS/JS function in the project as {path, text} rows, ready
 *  to embed. Tests excluded; Python skipped (its detector reports no doc text). */
async function fnTexts(dir: string): Promise<FnText[]> {
  const srcRoot = (await stat(join(dir, 'src')).then((s) => s.isDirectory()).catch(() => false))
    ? join(dir, 'src')
    : dir;
  const files = (await walk(srcRoot)).filter((f) => TS_SRC.test(f) && !TEST.test(f));
  const out: FnText[] = [];
  for (const abs of files) {
    const source = await readFile(abs, 'utf8').catch(() => '');
    if (!source) continue;
    const rel = relative(dir, abs);
    for (const fn of detectFunctionDocs(source)) {
      if (fn.doc.length < MIN_DOC || SKIP_NAMES.has(fn.name)) continue;
      out.push({ path: `${rel}:${fn.startLine} ${fn.name}()`, text: `${fn.name}\n${fn.doc}` });
    }
  }
  return out;
}

/** Build (or load from cache) the doc-comment embedding index for a project's
 *  functions. Delegates to the shared embedIndex core (same cache shape as the
 *  module index), so similarPairs/rankBySimilarity work on the result unchanged. */
export async function buildFnIndex(dir: string, opts: IndexOpts = {}): Promise<Indexed[]> {
  return embedIndex(join(dir, '.probevane', 'search-fn-index.json'), await fnTexts(dir), opts);
}
