import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Brain, BrainRequest } from './brain.js';
import type { BrainResponse, ToolCall } from '../loop/types.js';
import { statePath } from '../util/state.js';
import { estimateRequestTokens, estimateOutputTokens } from '../cost/estimate.js';

// bridge brain — delegates each turn to a subagent running in the HOST harness
// (a Claude Code session), via a filesystem request/response queue. probevane
// writes the EXACT prompt it would send the API (system + transcript + tools) to
// req-<n>.json and blocks; the host services it with a subagent and writes
// res-<n>.json. Sends our prompt only (no claude -p system overhead), billed to
// the host session. Drop-in Brain — the loop/gates are unchanged.
//
// Response contract (host writes): {"text"?: string, "tool_calls": [{"name","input"}], "costUsd"?: number}

const DIR = process.env.PROBEVANE_BRIDGE_DIR ?? statePath('bridge');
const POLL_MS = Number(process.env.PROBEVANE_BRIDGE_POLL_MS ?? 1000);
const TIMEOUT_MS = Number(process.env.PROBEVANE_BRIDGE_TIMEOUT_MS ?? 900_000);

export function bridgeBrain(): Brain {
  let seq = 0;
  const pid = process.pid; // unique per process → no req/res collision when runs are concurrent
  mkdirSync(DIR, { recursive: true });
  return {
    id: 'bridge',
    model: 'bridge',
    async complete(req: BrainRequest): Promise<BrainResponse> {
      const n = `${pid}-${++seq}`; // e.g. req-12345-1.json; servicer matches any req-*/res-*
      const reqPath = join(DIR, `req-${n}.json`);
      const resPath = join(DIR, `res-${n}.json`);
      // Send the same shape we'd send the API: system, transcript, tool schemas.
      writeFileSync(reqPath, JSON.stringify({
        system: req.system,
        messages: req.messages,
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      }, null, 2));

      const res = await poll(resPath);
      rmSync(reqPath, { force: true });
      rmSync(resPath, { force: true });
      // Meter tokens even though the bridge bills $0 — Phase-5 cost projection
      // reprices this volume at API rates (host may also report exact counts).
      return toResponse(res, estimateRequestTokens(req));
    },
  };
}

function poll(resPath: string): Promise<any> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (existsSync(resPath)) {
        try { return resolve(JSON.parse(readFileSync(resPath, 'utf8'))); }
        catch { /* host still writing — retry next tick */ }
      }
      if (Date.now() - start > TIMEOUT_MS) return reject(new Error(`bridge timeout waiting for ${resPath}`));
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

export function toResponse(res: any, estimatedInput = 0): BrainResponse {
  const calls: ToolCall[] = Array.isArray(res?.tool_calls)
    ? res.tool_calls
        .filter((c: any) => c && typeof c.name === 'string')
        .map((c: any, i: number) => ({ id: `bridge-${i}`, name: c.name, input: c.input ?? {} }))
    : [];
  const text = typeof res?.text === 'string' ? res.text : '';
  // Prefer host-reported exact counts; otherwise fall back to the heuristic estimate.
  const input = typeof res?.usage?.input === 'number' ? res.usage.input : estimatedInput;
  const output = typeof res?.usage?.output === 'number' ? res.usage.output : estimateOutputTokens(text, calls);
  return {
    text,
    toolCalls: calls,
    stopReason: calls.length ? 'tool_use' : 'end_turn',
    usage: { input, output, costUsd: typeof res?.costUsd === 'number' ? res.costUsd : 0 },
  };
}
