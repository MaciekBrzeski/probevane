import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Brain, BrainRequest } from './brain.js';
import type { BrainResponse, ToolCall } from '../loop/types.js';

// bridge brain — delegates each turn to a subagent running in the HOST harness
// (a Claude Code session), via a filesystem request/response queue. probevane
// writes the EXACT prompt it would send the API (system + transcript + tools) to
// req-<n>.json and blocks; the host services it with a subagent and writes
// res-<n>.json. Sends our prompt only (no claude -p system overhead), billed to
// the host session. Drop-in Brain — the loop/gates are unchanged.
//
// Response contract (host writes): {"text"?: string, "tool_calls": [{"name","input"}], "costUsd"?: number}

const DIR = process.env.PROBEVANE_BRIDGE_DIR ?? join(homedir(), '.local/share/probevane/bridge');
const POLL_MS = Number(process.env.PROBEVANE_BRIDGE_POLL_MS ?? 1000);
const TIMEOUT_MS = Number(process.env.PROBEVANE_BRIDGE_TIMEOUT_MS ?? 900_000);

export function bridgeBrain(): Brain {
  let seq = 0;
  mkdirSync(DIR, { recursive: true });
  return {
    id: 'bridge',
    model: 'bridge',
    async complete(req: BrainRequest): Promise<BrainResponse> {
      const n = ++seq;
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
      return toResponse(res);
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

export function toResponse(res: any): BrainResponse {
  const calls: ToolCall[] = Array.isArray(res?.tool_calls)
    ? res.tool_calls
        .filter((c: any) => c && typeof c.name === 'string')
        .map((c: any, i: number) => ({ id: `bridge-${i}`, name: c.name, input: c.input ?? {} }))
    : [];
  return {
    text: typeof res?.text === 'string' ? res.text : '',
    toolCalls: calls,
    stopReason: calls.length ? 'tool_use' : 'end_turn',
    usage: { input: 0, output: 0, costUsd: typeof res?.costUsd === 'number' ? res.costUsd : 0 },
  };
}
