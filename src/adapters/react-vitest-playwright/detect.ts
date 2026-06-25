import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Confidence that this is a React project we can drive with vitest + playwright.
 *   +0.5 react dependency
 *   +0.3 vite or react-scripts (a recognizable build)
 *   +0.2 a tsx/jsx source file present
 */
export async function detectReact(dir: string): Promise<number> {
  let pkg: any;
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  } catch {
    return 0;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  let score = 0;
  if (deps.react) score += 0.5;
  if (deps.vite || deps['react-scripts']) score += 0.3;
  // crude source-file sniff via package fields; the deep check happens in discover()
  if (deps['@vitejs/plugin-react'] || deps.typescript) score += 0.2;
  return Math.min(score, 1);
}
