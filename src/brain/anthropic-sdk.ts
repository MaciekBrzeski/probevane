import Anthropic from '@anthropic-ai/sdk';
import type { Brain, BrainRequest } from './brain.js';
import type { BrainResponse, Msg, StopReason, ToolCall } from '../loop/types.js';
import { apiLimiter } from './limiter.js';

// Default brain: native Anthropic Messages API with tool use. Bills API credits
// (Max plan can't do reliable per-turn tool calls — see runestone notes).
// Retries on 429/529/5xx with backoff so self-host rate limits don't kill a run.

const DEFAULT_MODEL = process.env.PROBEVANE_MODEL ?? 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 5;
const DELTA_FLUSH = 200; // chars — throttle live-token deltas so the event log stays bounded

/** Split a growing buffer into >=flushAt-char chunks; return the chunks + remainder.
 *  Pure — bounds how many delta events a stream emits. */
export function flushBuffer(buffer: string, flushAt: number): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let rest = buffer;
  while (rest.length >= flushAt) {
    chunks.push(rest.slice(0, flushAt));
    rest = rest.slice(flushAt);
  }
  return { chunks, rest };
}

export function anthropicBrain(model = DEFAULT_MODEL): Brain {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return {
    id: 'anthropic-sdk',
    model,
    async complete(req: BrainRequest): Promise<BrainResponse> {
      // Validate the secret WHEN the API brain is actually used (not at construction —
      // a local/$0 run still constructs a default Sonnet takeover it never invokes).
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          'ANTHROPIC_API_KEY is not set — required for the API brain. Set it (see .env.example) ' +
            'or use a local model (--model local:<id>) / the bridge (--model bridge).',
        );
      }
      // Prompt caching: the system block + tools are large and STABLE across the
      // whole run (base prompt + rune additions + RAG few-shot + tool specs).
      // Marking the end of that prefix with cache_control makes every turn after
      // the first re-read it from cache instead of re-billing it as input — the
      // big self-host token lever (runestone measured ~88% input-token drop).
      const tools = req.tools.map((t, i) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as any,
        // breakpoint on the last tool caches everything before it (system + tools)
        ...(i === req.tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
      }));
      // Second breakpoint on the STABLE transcript prefix: once a message has
      // been pruned to a stub it never changes again, so a cache_control there
      // caches the whole growing prefix (system + tools is the first; this is the
      // second of Anthropic's ≤4). The live tail after it is re-sent uncached but
      // bounded by the prune window. Skips the very last message (the live turn).
      const cpi = req.cachePrefixIndex;
      const messages = req.messages.map((m, i) =>
        cpi !== undefined && i === cpi && i < req.messages.length - 1
          ? withCacheBreakpoint(toApiMsg(m))
          : toApiMsg(m),
      );
      const body = {
        model,
        max_tokens: 4096,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
      };

      // Stream by default — assembling the final message avoids request timeouts
      // on long generations (the SDK's own guidance). Same BrainResponse out.
      // PROBEVANE_NO_STREAM=1 falls back to a single create() call.
      const noStream = process.env.PROBEVANE_NO_STREAM === '1';

      // Bound in-flight API calls so concurrent targets/repos don't blow the TPM.
      return apiLimiter.run(async () => {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (noStream) return fromApi(await client.messages.create(body as any));
            const stream = client.messages.stream(body as any);
            // Live tokens: throttle text deltas to the engine's sink (opt-in upstream).
            if (req.onDelta) {
              let buf = '';
              stream.on('text', (t: string) => {
                buf += t;
                const { chunks, rest } = flushBuffer(buf, DELTA_FLUSH);
                buf = rest;
                for (const c of chunks) req.onDelta!(c);
              });
              const msg = await stream.finalMessage();
              if (buf) req.onDelta(buf); // flush the tail
              return fromApi(msg);
            }
            return fromApi(await stream.finalMessage());
          } catch (e: any) {
            lastErr = e;
            const status = e?.status ?? e?.response?.status;
            if (![429, 529, 500, 502, 503, 504].includes(status) || attempt === MAX_RETRIES) throw e;
            const wait = Math.min(60_000, 1000 * 2 ** attempt);
            await new Promise((r) => setTimeout(r, wait));
          }
        }
        throw lastErr;
      });
    },
  };
}

/** Mark the LAST content block of an already-built API message as a cache breakpoint. */
export function withCacheBreakpoint(am: any): any {
  let content = am.content;
  if (typeof content === 'string') content = [{ type: 'text', text: content }];
  if (!Array.isArray(content) || content.length === 0) return am;
  const last = content.length - 1;
  content = content.map((b: any, j: number) =>
    j === last ? { ...b, cache_control: { type: 'ephemeral' } } : b,
  );
  return { ...am, content };
}

export function toApiMsg(m: Msg): any {
  const content: any[] = [];
  if (m.role === 'assistant') {
    if (m.text) content.push({ type: 'text', text: m.text });
    for (const c of m.toolCalls ?? [])
      content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
  } else {
    for (const r of m.toolResults ?? [])
      content.push({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.content,
        is_error: r.isError,
      });
    if (m.text) content.push({ type: 'text', text: m.text });
  }
  return { role: m.role, content: content.length ? content : (m.text ?? '') };
}

export function fromApi(resp: any): BrainResponse {
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const block of resp.content ?? []) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use')
      toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
  }
  const stopReason: StopReason =
    resp.stop_reason === 'tool_use'
      ? 'tool_use'
      : resp.stop_reason === 'end_turn'
        ? 'end_turn'
        : resp.stop_reason === 'max_tokens'
          ? 'max_tokens'
          : 'other';
  return {
    text,
    toolCalls,
    stopReason,
    usage: {
      input: resp.usage?.input_tokens ?? 0,
      output: resp.usage?.output_tokens ?? 0,
      cacheRead: resp.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: resp.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}
