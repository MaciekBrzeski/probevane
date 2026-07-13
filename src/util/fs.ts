import { stat } from 'node:fs/promises';

// Filesystem micro-helpers — consolidated from per-module copies surfaced by
// `search --similar --fns` (loop/tools, mfe/contract-scan, cli/ci each had one).

/** stat-based existence check that never throws — a missing path is just false. */
export async function pathExists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false);
}
