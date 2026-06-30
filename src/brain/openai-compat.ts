import type { Brain, BrainRequest } from './brain.js';
import type { BrainResponse, Msg, StopReason, ToolCall } from '../loop/types.js';

// OpenAI-compatible backend — Ollama / vLLM / llama.cpp / LM Studio, anything
// exposing POST /v1/chat/completions with function tool-calling. Cheap/offline
// alternative to the Anthropic brain. Base URL: PROBEVANE_BASE_URL (default
// Ollama). Key: PROBEVANE_API_KEY / OPENAI_API_KEY (optional for local servers).

const MAX_RETRIES = 4;
const TIMEOUT_MS = Number(process.env.PROBEVANE_HTTP_TIMEOUT_MS ?? 120_000);

function buildBody(model: string, req: BrainRequest) {
  return {
    model,
    max_tokens: 4096,
    // Greedy (temperature 0) — deterministic output so gate-feedback repair is
    // reproducible (fourier-nca lesson: do_sample=False for the repair loop).
    temperature: 0,
    messages: toApiMessages(req),
    tools: req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    })),
    tool_choice: 'auto',
  };
}

/** One request attempt — fetch + status handling; throws on non-OK (caller retries). */
async function attemptComplete(
  baseUrl: string,
  key: string,
  body: unknown,
  attempt: number,
): Promise<BrainResponse> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: ctl.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < MAX_RETRIES) throw new Error(`retry ${res.status}`);
    throw new Error(`${res.status} ${await res.text().catch(() => '')}`);
  }
  return fromApi(await res.json());
}

async function completeWith(baseUrl: string, key: string, model: string, req: BrainRequest): Promise<BrainResponse> {
  const body = buildBody(model, req);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await attemptComplete(baseUrl, key, body, attempt);
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
    }
  }
  throw lastErr;
}

export function openaiCompatBrain(model: string): Brain {
  const baseUrl = (process.env.PROBEVANE_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/$/, '');
  const key = process.env.PROBEVANE_API_KEY ?? process.env.OPENAI_API_KEY ?? 'sk-local';
  return {
    id: 'openai-compat',
    model,
    async complete(req: BrainRequest): Promise<BrainResponse> {
      return completeWith(baseUrl, key, model, req);
    },
  };
}

export function toApiMessages(req: BrainRequest): any[] {
  const out: any[] = [{ role: 'system', content: req.system }];
  for (const m of req.messages) {
    if (m.role === 'assistant') {
      const msg: any = { role: 'assistant', content: m.text ?? '' };
      if (m.toolCalls?.length)
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        }));
      out.push(msg);
    } else {
      // tool results become individual `tool` messages; trailing user text its own.
      for (const r of m.toolResults ?? []) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
      if (m.text) out.push({ role: 'user', content: m.text });
    }
  }
  return out;
}

export function fromApi(resp: any): BrainResponse {
  const choice = resp.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc: any) => ({
    id: tc.id ?? `call_${tc.function?.name}`,
    name: tc.function?.name,
    input: safeParse(tc.function?.arguments),
  }));
  const fr = choice.finish_reason;
  const stopReason: StopReason =
    fr === 'tool_calls' || toolCalls.length
      ? 'tool_use'
      : fr === 'length'
        ? 'max_tokens'
        : fr === 'stop'
          ? 'end_turn'
          : 'other';
  return {
    text: message.content ?? '',
    toolCalls,
    stopReason,
    usage: { input: resp.usage?.prompt_tokens ?? 0, output: resp.usage?.completion_tokens ?? 0 },
  };
}

function safeParse(s: unknown): Record<string, unknown> {
  if (typeof s !== 'string') return (s as any) ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
