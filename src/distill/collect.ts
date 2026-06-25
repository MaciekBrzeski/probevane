import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import type { RunCtx } from '../loop/ctx.js';

// A test/spec file across every supported stack (js/ts, python, go, rust).
const TEST_RE = /(\.(test|spec)\.[tj]sx?$)|(test_\w+\.py$)|(_test\.py$)|(_test\.go$)|(tests\/.*\.rs$)/;

// Collect ACCEPTED runs as distillation traces. Each trace pairs the run's
// input context (stack + task) with the accepted spec it produced — the
// transformation we want a local model to learn (the DISCIPLINE; facts stay in
// RAG/context per the RAG-beats-distill lesson). Opt-in via PROBEVANE_TRACES=1.
export const TRACES_PATH = join(homedir(), '.local/share/probevane/traces/traces.jsonl');

export interface Trace {
  ts: string;
  stack: string;
  task: string;
  specPath: string;
  spec: string;
}

/** Append one trace per accepted spec file. `now` is injected for testability. */
export async function recordTrace(ctx: RunCtx, now: string): Promise<number> {
  let n = 0;
  await mkdir(join(homedir(), '.local/share/probevane/traces'), { recursive: true }).catch(() => {});
  for (const rel of ctx.editedFiles) {
    if (!TEST_RE.test(rel)) continue;
    const spec = await readFile(join(ctx.workdir, rel), 'utf8').catch(() => '');
    if (!spec.trim()) continue;
    const trace: Trace = { ts: now, stack: ctx.adapter.id, task: ctx.task, specPath: rel, spec };
    await appendFile(TRACES_PATH, JSON.stringify(trace) + '\n');
    n++;
  }
  return n;
}

export async function readTraces(path = TRACES_PATH): Promise<Trace[]> {
  const txt = await readFile(path, 'utf8').catch(() => '');
  return txt
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Trace);
}
