import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sh } from '../util/exec.js';

// Oracle golden-lock (ADR-022 Phase 1). For golden / byte-stable oracle kinds:
// run the declared `producer` command, take its stdout as the artifact, and on
// first green LOCK it under .probevane/oracles/<key>.json (committed); on later
// runs verify byte-equality and block on drift. Mirrors the mutation ratchet
// (src/loop/mutation-baseline.ts): capture → commit → verify, keyed on a stable
// key (the module path), not a line.

/** A locked golden: the producer that made it + the exact artifact text. */
export interface GoldenLock {
  producer: string;
  artifact: string;
  lockedAt?: string; // ISO stamp, provenance only — NOT part of the equality check
}

/** Outcome of reconciling a run against a golden. */
export type GoldenOutcome =
  | { status: 'locked' } // first green — the golden was just written
  | { status: 'match' } // artifact equals the locked golden
  | { status: 'mismatch'; detail: string } // artifact drifted from the locked golden
  | { status: 'producer-failed'; detail: string }; // the producer command exited non-zero

/** Filesystem-safe key for a golden file (module path → single filename). */
export function goldenKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/** Absolute path of a key's locked golden file inside the target's .probevane/. */
function goldenPath(dir: string, key: string): string {
  return join(dir, '.probevane', 'oracles', `${goldenKey(key)}.json`);
}

/** Result of running an oracle's producer (its stdout is the artifact). */
export interface CaptureResult {
  ok: boolean;
  text: string;
  err: string;
}

/** Run the producer; its stdout is the artifact. Never throws (sh captures). */
export async function captureOracle(dir: string, producer: string): Promise<CaptureResult> {
  const r = await sh(producer, dir);
  return { ok: r.ok, text: r.stdout, err: (r.stderr || r.stdout).slice(-1500) };
}

/** Load the locked golden for a key; undefined when none exists (or unreadable). */
export function readGolden(dir: string, key: string): GoldenLock | undefined {
  try {
    return JSON.parse(readFileSync(goldenPath(dir, key), 'utf8')) as GoldenLock;
  } catch {
    return undefined;
  }
}

/** Persist a golden (first-green lock). */
export function writeGolden(dir: string, key: string, lock: GoldenLock): void {
  mkdirSync(join(dir, '.probevane', 'oracles'), { recursive: true });
  writeFileSync(goldenPath(dir, key), JSON.stringify(lock, null, 2) + '\n');
}

/** Compare an artifact to a locked golden. Pure. 'locked' means no golden yet
 *  (the caller writes it); the diff names where they diverge. */
export function checkGolden(locked: GoldenLock | undefined, artifact: string): GoldenOutcome {
  if (!locked) return { status: 'locked' };
  if (locked.artifact === artifact) return { status: 'match' };
  return { status: 'mismatch', detail: goldenDiff(locked.artifact, artifact) };
}

/** A compact human diff: lengths + the first differing line. */
function goldenDiff(a: string, b: string): string {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return `line ${i + 1}: locked ${JSON.stringify(la[i] ?? '<eof>')} != now ${JSON.stringify(lb[i] ?? '<eof>')}`;
  }
  return `lengths ${a.length} vs ${b.length}`;
}

/** End-to-end: run the producer, then lock-on-first-green or verify. Writes the
 *  golden when absent. Returns the reconciled outcome for the gate to act on. */
export async function runGoldenOracle(
  dir: string, key: string, producer: string, stamp?: string,
): Promise<GoldenOutcome> {
  const cap = await captureOracle(dir, producer);
  if (!cap.ok) return { status: 'producer-failed', detail: cap.err };
  const outcome = checkGolden(readGolden(dir, key), cap.text);
  if (outcome.status === 'locked') writeGolden(dir, key, { producer, artifact: cap.text, lockedAt: stamp });
  return outcome;
}
