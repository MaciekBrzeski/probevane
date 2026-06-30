import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// CPU model bake-off — single-shot each candidate model (forced onto CPU,
// num_gpu=0) to write a test, then SCORE it with the real adapter. Finds the
// best base for GPU-less machines: quality + CPU throughput, no GPU contention.
// Single-shot (not the tool loop) because weak local models do poorly at
// multi-turn tool-calling; this measures raw test-writing skill.
export interface BaseResult {
  model: string;
  green: boolean;
  tests: number;
  coverage: number;
  auditErrors: number;
  ms: number;
  tokPerSec: number;
  value: number;
}

const OLLAMA = (process.env.PROBEVANE_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');

/** One completion, forced onto CPU via ollama-native options.num_gpu=0. */
export async function cpuGenerate(
  model: string,
  system: string,
  user: string,
  numPredict = 700,
): Promise<{ text: string; ms: number; tokPerSec: number }> {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
      options: { num_gpu: 0, num_predict: numPredict, temperature: 0.1 },
    }),
  });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${await res.text().catch(() => '')}`);
  const d: any = await res.json();
  const ms = Date.now() - t0;
  const tokPerSec = d.eval_count && d.eval_duration ? +(d.eval_count / (d.eval_duration / 1e9)).toFixed(1) : 0;
  return { text: d.message?.content ?? '', ms, tokPerSec };
}

/** Strip a ```lang fence if the model wrapped its code. */
export function stripFences(text: string): string {
  const m = text.match(/```[a-z]*\n([\s\S]*?)```/);
  return (m ? m[1] : text).trim();
}

const SYSTEM =
  'You write tests. Import the real symbols, assert concrete values with multiple cases, cover error paths. Output ONLY the test file, no prose.';

/** Build the per-model prompt for a target source file (read once). */
export async function basePrompt(dir: string, sourcePath: string, instruction: string): Promise<string> {
  const src = await readFile(join(dir, sourcePath), 'utf8').catch(() => '');
  return `Source ${sourcePath}:\n\n${src}\n\n${instruction}`;
}

// Composite: green is a hard gate; then coverage + tests, audit penalty.
export function baseValue(r: { green: boolean; tests: number; coverage: number; auditErrors: number }): number {
  if (!r.green) return -1;
  return +(r.coverage + r.tests * 5 - r.auditErrors * 10).toFixed(1);
}
