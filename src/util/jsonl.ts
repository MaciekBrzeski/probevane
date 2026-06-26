import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Append-only JSONL with an in-process write lock so concurrent appends within a
// process can't interleave into a torn line (the bug behind corrupted ledger /
// traces / index lines). Each path gets its own promise chain; writes serialize.
// O_APPEND keeps small cross-process lines intact too; large-line cross-process
// atomicity (>OS write limit) is a Phase-3 concern (lockfile/DB) — readers below
// already skip malformed lines as defense.

const chains = new Map<string, Promise<void>>();

export async function appendJsonl(path: string, obj: unknown): Promise<void> {
  const line = JSON.stringify(obj) + '\n';
  const prev = chains.get(path) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(path), { recursive: true }).catch(() => {});
      await appendFile(path, line);
    });
  chains.set(path, next);
  return next;
}

/** Read a JSONL file, skipping blank/malformed lines (torn-write defense). */
export async function readJsonl<T = unknown>(path: string): Promise<T[]> {
  const txt = await readFile(path, 'utf8').catch(() => '');
  const out: T[] = [];
  for (const l of txt.split('\n')) {
    const s = l.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as T);
    } catch {
      /* skip torn / partial line */
    }
  }
  return out;
}
