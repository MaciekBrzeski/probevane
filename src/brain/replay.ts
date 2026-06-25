import { createHash } from 'node:crypto';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Brain, BrainRequest } from './brain.js';
import type { BrainResponse } from '../loop/types.js';

// Record/replay brain — cassettes make `eval --live` deterministic and
// credit-free in CI. Record once against a live brain, then replay offline.
// A cassette is JSON-lines: { hash, response } keyed by a stable hash of the
// (system, messages, tools) request.

function hashRequest(req: BrainRequest): string {
  const stable = JSON.stringify({ system: req.system, messages: req.messages, tools: req.tools.map((t) => t.name) });
  return createHash('sha1').update(stable).digest('hex');
}

/** Wrap a brain so every call is appended to a cassette. */
export function recordingBrain(inner: Brain, cassettePath: string): Brain {
  return {
    id: `record(${inner.id})`,
    model: inner.model,
    async complete(req: BrainRequest): Promise<BrainResponse> {
      const resp = await inner.complete(req);
      await mkdir(dirname(cassettePath), { recursive: true }).catch(() => {});
      await appendFile(cassettePath, JSON.stringify({ hash: hashRequest(req), response: resp }) + '\n').catch(() => {});
      return resp;
    },
  };
}

/** Replay responses from a cassette; throws on an unrecorded request. */
export function replayBrain(cassettePath: string, model = 'replay'): Brain {
  let table: Map<string, BrainResponse> | null = null;
  const load = async () => {
    if (table) return table;
    table = new Map();
    const txt = await readFile(cassettePath, 'utf8').catch(() => '');
    for (const line of txt.trim().split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      table.set(row.hash, row.response);
    }
    return table;
  };
  return {
    id: 'replay',
    model,
    async complete(req: BrainRequest): Promise<BrainResponse> {
      const t = await load();
      const hit = t.get(hashRequest(req));
      if (!hit) throw new Error(`replay: no cassette entry for this request (${cassettePath}) — re-record`);
      return hit;
    },
  };
}
