import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { flag } from '../cli/args.js';
import { classifyPrompt, resolveSpec, type Question } from './classify.js';
import type { RunSpec } from './runspec.js';

// The intake plumbing shared by `intake` and `factory-dark`: classify the prompt,
// gather answers (policy file > interactive TTY > lights-out defaults), and
// assemble the validated RunSpec. Kept out of cli/* so a second command can import
// it without triggering another command's top-level main().

/** Read a --answers policy JSON (field→answer), or null when the flag is absent. */
export async function readPolicy(args: string[]): Promise<Record<string, string> | null> {
  const f = flag(args, '--answers');
  if (!f) return null;
  return JSON.parse(await readFile(resolve(f), 'utf8')) as Record<string, string>;
}

/** Ask the questions on the terminal (prompts to stderr so --json stdout stays clean). */
export async function askQuestions(questions: Question[]): Promise<Record<string, string>> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ans: Record<string, string> = {};
  try {
    for (const q of questions) {
      const raw = await new Promise<string>((r) => rl.question(`${q.ask} [${q.options.join('/')}] (${q.def}): `, r));
      ans[q.field] = raw.trim() || q.def;
    }
  } finally {
    rl.close();
  }
  return ans;
}

/** Gather answers by mode: --answers policy > interactive TTY > defaults (lights-out). */
export async function gatherAnswers(args: string[], questions: Question[]): Promise<Record<string, string>> {
  const policy = await readPolicy(args);
  if (policy) return policy;
  if (args.includes('--interactive') && process.stdin.isTTY) return askQuestions(questions);
  return Object.fromEntries(questions.map((q) => [q.field, q.def]));
}

/** Classify → gather answers → resolve into a validated-shape RunSpec. */
export async function buildSpec(prompt: string, dir: string, args: string[]): Promise<RunSpec> {
  const { draft, questions } = classifyPrompt(prompt);
  const answers = await gatherAnswers(args, questions);
  return resolveSpec(
    {
      id: randomUUID().slice(0, 8),
      dir: resolve(dir),
      prompt,
      model: flag(args, '--model'),
      takeover: flag(args, '--takeover'),
      strict: args.includes('--strict'),
    },
    draft,
    answers,
  );
}
