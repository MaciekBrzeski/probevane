import Anthropic from '@anthropic-ai/sdk';
import type { Brain, BrainRequest } from './brain.js';
import type { BrainResponse, Msg, StopReason, ToolCall } from '../loop/types.js';

// Default brain: native Anthropic Messages API with tool use. Bills API credits
// (Max plan can't do reliable per-turn tool calls — see runestone notes).
// Retries on 429/529/5xx with backoff so self-host rate limits don't kill a run.

const DEFAULT_MODEL = process.env.PROBEVANE_MODEL ?? 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 5;

export function anthropicBrain(model = DEFAULT_MODEL): Brain {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return {
    id: 'anthropic-sdk',
    model,
    async complete(req: BrainRequest): Promise<BrainResponse> {
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

      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const resp = await client.messages.create(body as any);
          return fromApi(resp);
        } catch (e: any) {
          lastErr = e;
          const status = e?.status ?? e?.response?.status;
          if (![429, 529, 500, 502, 503, 504].includes(status) || attempt === MAX_RETRIES) throw e;
          const wait = Math.min(60_000, 1000 * 2 ** attempt);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      throw lastErr;
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

function fromApi(resp: any): BrainResponse {
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
