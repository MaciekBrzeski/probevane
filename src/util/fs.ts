import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Filesystem micro-helpers — consolidated from per-module copies surfaced by
// `search --similar --fns` (loop/tools, mfe/contract-scan, cli/ci had pathExists;
// six modules — adapters go/svelte, quality/scan, mock/graph, doctor, cli/a11y —
// each had a near-identical recursive `walk`, differing only in their skip set).

/** stat-based existence check that never throws — a missing path is just false. */
export async function pathExists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false);
}

/** Recursively list every file under `dir` (absolute paths), pruning directories
 *  whose name is in `skip`. Unreadable dirs read as empty, so one bad entry can't
 *  fail the whole walk. The deliberate per-caller difference — WHICH dirs to
 *  prune — is the `skip` argument; everything else was identical across the copies. */
export async function walk(dir: string, skip: ReadonlySet<string> = new Set()): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (!skip.has(e.name)) out.push(...(await walk(join(dir, e.name), skip)));
    } else out.push(join(dir, e.name));
  }
  return out;
}
