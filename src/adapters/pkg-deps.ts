import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Read a repo's combined dependencies + devDependencies from its package.json.
 *  Returns {} on any error (missing/unparseable). Shared by stack adapters' detect(). */
export async function readPackageDeps(dir: string): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}
