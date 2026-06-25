import { sh } from './util/exec.js';

// Minimal git helpers for the repair + CI paths.

/** Source files changed vs a ref (default: working tree vs HEAD). */
export async function changedFiles(dir: string, ref = 'HEAD'): Promise<string[]> {
  // Tracked changes vs ref + staged + unstaged, plus untracked.
  const a = await sh(`git diff --name-only ${ref}`, dir);
  const b = await sh(`git ls-files --others --exclude-standard`, dir);
  const files = new Set<string>();
  for (const out of [a.stdout, b.stdout])
    for (const line of out.split('\n').map((l) => l.trim()).filter(Boolean)) files.add(line);
  return [...files];
}

export function isSourceFile(f: string): boolean {
  if (!/\.(tsx?|jsx?|vue|svelte|py|go)$/.test(f)) return false;
  if (/\.(test|spec|d)\.[tj]sx?$/.test(f) || /(^|\/)(test_\w+|conftest)/.test(f) || /_test\.go$/.test(f)) return false;
  // config / generated / setup / entry files are not user source to test
  if (/\.config\.[tjm]s$/.test(f) || /(^|\/)(vitest\.setup|setupTests|vite-env)\./.test(f)) return false;
  if (/(^|\/)(mocks|__mocks__|node_modules)\//.test(f) || /(^|\/)(main|index)\.[tj]sx?$/.test(f)) return false;
  return true;
}

/** Guess the spec path(s) that cover a source file (sibling naming conventions). */
export function specCandidatesFor(source: string): string[] {
  const m = source.match(/^(.*)\.(tsx?|jsx?|vue)$/);
  if (m) return [`${m[1]}.test.tsx`, `${m[1]}.test.ts`, `${m[1]}.spec.tsx`, `${m[1]}.spec.ts`];
  const p = source.match(/^(.*)\.py$/);
  if (p) {
    const parts = p[1].split('/');
    const base = parts.pop();
    return [[...parts, `test_${base}.py`].join('/'), `${p[1]}_test.py`];
  }
  return [];
}
