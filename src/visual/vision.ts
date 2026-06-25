import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';

// A vision call — send a screenshot + a question to a multimodal Claude and get
// text back. Separate from the tool-calling brain (which is text-only); the
// visual-improvement loop uses this to JUDGE a rendered screenshot.
const VISION_MODEL = process.env.PROBEVANE_VISION_MODEL ?? 'claude-sonnet-4-6';

export async function visionAsk(pngPath: string, system: string, userText: string): Promise<string> {
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
