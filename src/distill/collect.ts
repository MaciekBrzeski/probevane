import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import type { RunCtx } from '../loop/ctx.js';

// A test/spec file across every supported stack (js/ts, python, go, rust).
const TEST_RE = /(\.(test|spec)\.[tj]sx?$)|(test_\w+\.py$)|(_test\.py$)|(_test\.go$)|(tests\/.*\.rs$)/;

/**
 * Mask secret-looking substrings in `text` before a trace is stored.
 *
 * Two rules:
 *  1. Replace the VALUE after keys matching /(api[_-]?key|token|secret|password|bearer)/i
 *     (when followed by `:` or `=`) with '[REDACTED]'.
 *  2. Replace standalone long hex/base64 runs (>=32 chars) with '[REDACTED]'.
 */
export function redact(text: string): string {
  // Rule 1: named-key patterns  (key= or key:)
  let result = text.replace(
    /(api[_-]?key|token|secret|password|bearer)\s*[:=]\s*(\S+)/gi,
    (_match, key: string) => `${key}=[REDACTED]`,
  );

  // Rule 2: standalone runs of base64/hex characters that are >= 32 chars long.
  // We look for sequences of [A-Za-z0-9+/_-] with length >= 32 that are surrounded
  // by non-alphanumeric boundaries (whitespace, quotes, start/end of string, etc.)
  // so we don't accidentally split normal words.
  result = result.replace(/(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{32,}(?![A-Za-z0-9+/_-])/g, '[REDACTED]');

  return result;
}

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
  /** Distinct gate-block reasons this run hit before the accepted spec — the
   *  failed→fixed signal. The completion (spec) is the version that satisfies
   *  them, so the dataset teaches the model to pre-empt these gates. */
  gateBlocks?: string[];
}

/** Append one trace per accepted spec file. `now` is injected for testability. */
export async function recordTrace(ctx: RunCtx, now: string): Promise<number> {
  let n = 0;
  await mkdir(join(homedir(), '.local/share/probevane/traces'), { recursive: true }).catch(() => {});
  for (const rel of ctx.editedFiles) {
    if (!TEST_RE.test(rel)) continue;
    const spec = await readFile(join(ctx.workdir, rel), 'utf8').catch(() => '');
    if (!spec.trim()) continue;
    const trace: Trace = {
      ts: now, stack: ctx.adapter.id, task: redact(ctx.task), specPath: rel, spec,
      gateBlocks: ctx.gateBlockReasons.length ? ctx.gateBlockReasons.map(redact) : undefined,
    };
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
