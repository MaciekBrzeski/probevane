import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Shared recursive file walk. The angular and node-vitest adapters both listed
// every file under src/ while skipping node_modules/dist/coverage; this is the
// single home for that traversal.

/** List every file under dir recursively, skipping node_modules/dist/coverage. */
export async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'coverage'].includes(e.name)) continue;
      out.push(...(await walkFiles(join(dir, e.name))));
    } else out.push(join(dir, e.name));
  }
  return out;
}
