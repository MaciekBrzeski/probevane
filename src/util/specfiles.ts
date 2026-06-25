import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const SPEC_RE = /\.(test|spec)\.[tj]sx?$/;

/** All test/spec files under `dir` (project-relative paths). */
export async function findSpecFiles(dir: string, sub = ''): Promise<string[]> {
  const abs = join(dir, sub);
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      out.push(...(await findSpecFiles(dir, join(sub, e.name))));
    } else if (SPEC_RE.test(e.name)) {
      out.push(join(sub, e.name));
    }
  }
  return out;
}
