import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { LIB_ROOT } from './store.js';

// Shared caveats file — gate-block reasons harvested across runs. Written by
// caveat_harvest, read by context_inject (the friction feedback loop).
export const CAVEATS_PATH = join(LIB_ROOT, 'caveats.md');

/** Most-recent distinct caveats (last N lines), for injection. */
export async function recentCaveats(limit = 10): Promise<string[]> {
  const txt = await readFile(CAVEATS_PATH, 'utf8').catch(() => '');
  const lines = txt.trim().split('\n').filter(Boolean);
  return lines.slice(-limit);
}
