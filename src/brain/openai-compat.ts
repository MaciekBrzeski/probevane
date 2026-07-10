import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Brain, BrainRequest } from './brain.js';
import type { BrainResponse, Msg, StopReason, ToolCall } from '../loop/types.js';

// OpenAI-compatible backend — Ollama / vLLM / llama.cpp / LM Studio, anything
// exposing POST /v1/chat/completions with function tool-calling. Cheap/offline
// alternative to the Anthropic brain. Base URL: PROBEVANE_BASE_URL (default
// Ollama). Key: PROBEVANE_API_KEY / OPENAI_API_KEY (optional for local servers).

// Ollama Cloud endpoint — `--model ollama[:<id>]` targets it with the key
// auto-loaded, so hard autonomous loops run there with zero env setup.
const OLLAMA_CLOUD = 'https://ollama.com/v1';
// Benchmarked best for HARD open-ended loops (multi-module networked generate):
// passed where glm-5.2 stalled, most token-efficient of the cloud coders.
export const OLLAMA_DEFAULT_MODEL = 'kimi-k2.7-code';

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

/** An OpenAI-compatible brain bound to a specific base URL + key. */
function openaiWith(baseUrl: string, key: string, model: string): Brain {
  const url = baseUrl.replace(/\/$/, '');
  return {
    id: 'openai-compat',
    model,
    async complete(req: BrainRequest): Promise<BrainResponse> {
      return completeWith(url, key, model, req);
    },
  };
}

export function openaiCompatBrain(model: string): Brain {
  const baseUrl = process.env.PROBEVANE_BASE_URL ?? 'http://localhost:11434/v1';
  const key = process.env.PROBEVANE_API_KEY ?? process.env.OPENAI_API_KEY ?? 'sk-local';
  return openaiWith(baseUrl, key, model);
}

/** Read the Ollama Cloud key: PROBEVANE_API_KEY / OPENAI_API_KEY, else the key
 *  file (PROBEVANE_OLLAMA_KEY_FILE, default ~/.config/probevane/ollama.key). */
function ollamaKey(): string {
  const env = process.env.PROBEVANE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (env) return env;
  const file = process.env.PROBEVANE_OLLAMA_KEY_FILE ?? join(homedir(), '.config', 'probevane', 'ollama.key');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    throw new Error(`ollama: no API key — set PROBEVANE_API_KEY or create ${file}`);
  }
}

/** Ollama Cloud brain: base URL fixed to the cloud endpoint, key auto-loaded,
 *  default model kimi-k2.7-code. Lets `--model ollama` run with zero env setup. */
export function ollamaCloudBrain(model = OLLAMA_DEFAULT_MODEL): Brain {
  return openaiWith(process.env.PROBEVANE_BASE_URL ?? OLLAMA_CLOUD, ollamaKey(), model);
}

/** Resolve (baseUrl, key) for a model string the way the brains do: `ollama[:id]`
 *  → Ollama Cloud + auto-key; anything else → the local OpenAI-compatible server. */
export function resolveEndpoint(model: string): { baseUrl: string; key: string; model: string } {
  if (model === 'ollama' || model.startsWith('ollama:')) {
    const id = model === 'ollama' ? OLLAMA_DEFAULT_MODEL : model.slice('ollama:'.length);
    return { baseUrl: process.env.PROBEVANE_BASE_URL ?? OLLAMA_CLOUD, key: ollamaKey(), model: id };
  }
  const id = model.startsWith('local:') ? model.slice('local:'.length) : model;
  return {
    baseUrl: process.env.PROBEVANE_BASE_URL ?? 'http://localhost:11434/v1',
    key: process.env.PROBEVANE_API_KEY ?? process.env.OPENAI_API_KEY ?? 'sk-local',
    model: id,
  };
}

/** Fill-in-the-middle completion via the OpenAI-compatible `/completions` endpoint
 *  (`suffix` param) — the classic FIM shape most coder models expose. Returns the
 *  infilled MIDDLE text. Throws if the endpoint is unavailable or returns no text
 *  (the caller can then fall back to a chat completion). */
export async function fimComplete(
  model: string,
  prefix: string,
  suffix: string,
  opts: { maxTokens?: number } = {},
): Promise<string> {
  const ep = resolveEndpoint(model);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const res = await fetch(`${ep.baseUrl.replace(/\/$/, '')}/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ep.key}` },
    body: JSON.stringify({
      model: ep.model,
      prompt: prefix,
      suffix,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: 0,
      stream: false,
    }),
    signal: ctl.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`fim ${res.status} ${await res.text().catch(() => '')}`);
  const json: any = await res.json();
  const text: string = json.choices?.[0]?.text ?? '';
  if (!text.trim()) throw new Error('fim: empty completion');
  return text;
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
