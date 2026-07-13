import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stateRoot } from '../util/state.js';

// Self-improvement decisions (Pillar D) — pure core + a tiny model-pointer store.
// Closes the learning loop: measure candidate-vs-incumbent, promote the better one
// by writing a pointer the loop reads as its default model. LoRA *training* stays
// the manual GPU step; this is the auto-measure + auto-promote among available
// models (the $0, decision half).

export interface EvalResult {
  model: string;
  acceptRate: number; // 0..1
  cost?: number; // USD per run (lower better on ties)
}

/** The persisted promotion decision at <state>/model.json — written by
 *  writeModelPointer, read back as the loop's default model. */
export interface ModelPointer {
  model: string;
  chosenAt: string;
  reason?: string;
}

/** Time for an improvement cycle once enough accepts have accrued since the last. */
export function dueForCycle(acceptsSinceLast: number, threshold: number): boolean {
  return threshold > 0 && acceptsSinceLast >= threshold;
}

/** The better of two eval results: higher acceptance, then lower cost, else incumbent (a). */
export function pickBetter(a: EvalResult, b: EvalResult): EvalResult {
  if (b.acceptRate > a.acceptRate) return b;
  if (b.acceptRate < a.acceptRate) return a;
  const ac = a.cost ?? Infinity;
  const bc = b.cost ?? Infinity;
  return bc < ac ? b : a;
}

export const POINTER_PATH = join(stateRoot(), 'model.json');

/** The promoted default model, or undefined if none chosen. */
export async function readModelPointer(path = POINTER_PATH): Promise<string | undefined> {
  return readFile(path, 'utf8')
    .then((s) => (JSON.parse(s) as ModelPointer).model)
    .catch(() => undefined);
}

/** Persist a promotion so future runs default to `model` (reason kept for the audit trail). */
export async function writeModelPointer(model: string, reason: string, path = POINTER_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const ptr: ModelPointer = { model, chosenAt: new Date().toISOString(), reason };
  await writeFile(path, JSON.stringify(ptr, null, 2));
}
