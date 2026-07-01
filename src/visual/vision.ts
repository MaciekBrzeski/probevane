import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// A vision call — send a screenshot + a question to a multimodal model and get
// text back. Separate from the tool-calling brain (text-only); the visual/design
// loops use this to JUDGE a rendered screenshot (and to rewrite the source).
//
// Two backends:
//   - Anthropic (default): PROBEVANE_VISION_MODEL=claude-* (needs credits).
//   - OpenAI-compatible vision (e.g. Ollama Cloud minimax-m3 / gemini-3-flash,
//     $0): set PROBEVANE_VISION_BASE (e.g. https://ollama.com/v1) + a non-claude
//     PROBEVANE_VISION_MODEL. Key from PROBEVANE_VISION_KEY / PROBEVANE_API_KEY /
//     the ollama key file (same resolution as the ollama brain).
const VISION_MODEL = process.env.PROBEVANE_VISION_MODEL ?? 'claude-sonnet-4-6';
const VISION_BASE = process.env.PROBEVANE_VISION_BASE;

/** True when the vision call should use the OpenAI-compatible (ollama) backend. */
export function usesOpenAiVision(model = VISION_MODEL, base = VISION_BASE): boolean {
  return !!base || !model.startsWith('claude');
}

function visionKey(): string {
  const env = process.env.PROBEVANE_VISION_KEY ?? process.env.PROBEVANE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (env) return env;
  const file = process.env.PROBEVANE_OLLAMA_KEY_FILE ?? join(homedir(), '.config', 'probevane', 'ollama.key');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    throw new Error(`vision: no API key — set PROBEVANE_VISION_KEY or create ${file}`);
  }
}

async function anthropicVision(pngPath: string, system: string, userText: string): Promise<string> {
  const client = new Anthropic();
  const b64 = (await readFile(pngPath)).toString('base64');
  const resp = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 4096,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: userText },
        ],
      },
    ],
  } as any);
  return (resp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}

async function openaiVision(pngPath: string, system: string, userText: string): Promise<string> {
  const b64 = (await readFile(pngPath)).toString('base64');
  const base = (VISION_BASE ?? 'https://ollama.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${visionKey()}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 8192, // headroom: reasoning models (minimax) spend tokens before the answer
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`vision ${res.status} ${await res.text().catch(() => '')}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string; reasoning?: string } }[] };
  const m = j.choices?.[0]?.message;
  // Reasoning models (e.g. minimax) sometimes leave `content` empty and put the
  // answer in `reasoning` — fall back so the caller always gets the text.
  return m?.content || m?.reasoning || '';
}

export async function visionAsk(pngPath: string, system: string, userText: string): Promise<string> {
  return usesOpenAiVision() ? openaiVision(pngPath, system, userText) : anthropicVision(pngPath, system, userText);
}
