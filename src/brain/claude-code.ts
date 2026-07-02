import { execFile } from 'node:child_process';
import type { Brain, BrainRequest } from './brain.js';
import type { BrainResponse, Msg, ToolSpec, ToolCall } from '../loop/types.js';
import { extractJsonStrict } from '../util/json.js';

// claude-code brain — drives the loop via the headless Claude Code CLI
// (`claude -p`) instead of the Messages API. A skill/contract tells the subagent
// to act as a PER-TURN completion engine: given the transcript + tool schemas,
// emit ONLY the next tool call as JSON, do not execute. probevane keeps its own
// gate/exec loop. Makes probevane drivable by any harness that speaks the same
// contract. NOTE: billing follows the CLI's auth (subscription vs API key); the
// returned usage drives the cost ledger either way.

const TIMEOUT_MS = Number(process.env.PROBEVANE_CC_TIMEOUT_MS ?? 180_000);

const CONTRACT = [
  'You are a PER-TURN completion engine for an external test-writing loop.',
  'Given the conversation and the available tools, decide the SINGLE next step.',
  'Respond with ONLY one JSON object, no prose, no markdown fence:',
  '{"text": "<short reasoning, optional>", "tool_calls": [{"name":"<tool>","input":{...}}]}',
  'Call exactly one tool per turn. To FINISH (let the gates run), return {"tool_calls": []}.',
  'Do NOT execute tools yourself, do NOT read or write files — only emit the JSON decision.',
].join('\n');

export function claudeCodeBrain(model?: string): Brain {
  return {
    id: 'claude-code',
    model: model ? `claude-code:${model}` : 'claude-code',
    async complete(req: BrainRequest): Promise<BrainResponse> {
      const prompt = buildPrompt(req);
      const args = ['-p', '--output-format', 'json'];
      if (model) args.push('--model', model);
      const env = { ...process.env };
      if (process.env.PROBEVANE_CC_SUBSCRIPTION === '1') delete env.ANTHROPIC_API_KEY; // force Max auth
      const out = await run('claude', args, prompt, env);
      const env_ = JSON.parse(out);
      const decision = parseDecision(String(env_.result ?? ''));
      const u = env_.usage ?? {};
      return {
        text: decision.text ?? '',
        toolCalls: decision.toolCalls,
        stopReason: decision.toolCalls.length ? 'tool_use' : 'end_turn',
        usage: {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          // The CLI reports actual cost (subscription or API); thread it so the
          // ledger reflects real spend instead of $0 (claude-code:* isn't priced).
          costUsd: typeof env_.total_cost_usd === 'number' ? env_.total_cost_usd : undefined,
        },
      };
    },
  };
}

function buildPrompt(req: BrainRequest): string {
  const tools = req.tools
    .map((t: ToolSpec) => `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(t.inputSchema)}`)
    .join('\n');
  const transcript = req.messages.map(renderMsg).join('\n\n');
  return [
    CONTRACT,
    '\n=== SYSTEM (the loop\'s instructions) ===\n' + req.system,
    '\n=== TOOLS ===\n' + tools,
    '\n=== CONVERSATION ===\n' + transcript,
    '\n=== YOUR JSON DECISION (one object, nothing else) ===',
  ].join('\n');
}

function renderMsg(m: Msg): string {
  if (m.role === 'assistant') {
    const calls = (m.toolCalls ?? []).map((c) => `CALL ${c.name}(${JSON.stringify(c.input)})`).join('\n');
    return `ASSISTANT: ${m.text ?? ''}${calls ? '\n' + calls : ''}`;
  }
  const results = (m.toolResults ?? []).map((r) => `RESULT[${r.isError ? 'error' : 'ok'}]: ${r.content}`).join('\n');
  return `USER: ${m.text ?? ''}${results ? '\n' + results : ''}`;
}

/** Pull the model's JSON decision out of its reply (raw, fenced, or embedded). */
export function parseDecision(text: string): { text?: string; toolCalls: ToolCall[] } {
  const obj = extractJson(text);
  if (!obj) return { text: text.trim() || undefined, toolCalls: [] };
  const calls: ToolCall[] = Array.isArray(obj.tool_calls)
    ? obj.tool_calls
        .filter((c: any) => c && typeof c.name === 'string')
        .map((c: any, i: number) => ({ id: `cc-${i}`, name: c.name, input: c.input ?? {} }))
    : [];
  return { text: typeof obj.text === 'string' && obj.text ? obj.text : undefined, toolCalls: calls };
}

/** First top-level JSON object in the text — the shared strict extractor, object-shaped. */
export function extractJson(text: string): any | null {
  return extractJsonStrict<Record<string, unknown>>(
    text,
    (x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x),
  );
}

function run(cmd: string, args: string[], input: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { env, maxBuffer: 16 * 1024 * 1024, timeout: TIMEOUT_MS },
      (err, stdout, stderr) => {
      if (err) return reject(new Error(`claude -p failed: ${err.message}\n${stderr}`));
      resolve(stdout);
    });
    child.stdin?.end(input);
  });
}
