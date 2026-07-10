// The feature planner — given a CURRENT state and a DESIRED state, a local model fills
// in the middle: the detailed, ordered steps between them. Two mechanisms behind one
// call: literal FIM (prefix=current, suffix=desired, model infills the steps) with a
// chat completion as fallback, so it works whether or not the chosen model does FIM.

import { fimComplete } from '../brain/openai-compat.js';
import { brainFor } from '../brain/select.js';
import { CHAT_SYSTEM, chatUser, fimPrefix, fimSuffix, parseSteps, type PlanStep } from './prompts.js';

export type PlanMode = 'auto' | 'fim' | 'chat';

export interface PlanOpts {
  model: string; // e.g. 'local:mk-coder:lora-v8' or 'ollama:kimi-k2.7-code'
  mode?: PlanMode; // default 'auto' — try FIM, fall back to chat
  steps?: number; // soft target step count (chat only)
}

export interface FeaturePlan {
  from: string;
  to: string;
  model: string;
  mode: 'fim' | 'chat'; // the mechanism that actually produced the steps
  steps: PlanStep[];
  raw: string; // the model's raw text (for debugging / --json)
}

/** Run the FIM path: infill the middle, re-attach the seeded "1. ", parse steps. */
async function viaFim(from: string, to: string, opts: PlanOpts): Promise<PlanStep[] | null> {
  try {
    const middle = await fimComplete(opts.model, fimPrefix(from), fimSuffix(to));
    const steps = parseSteps('1. ' + middle);
    return steps.length ? steps : null;
  } catch {
    return null; // endpoint down, model not FIM-capable, or empty — caller falls back
  }
}

/** Run the chat path: prompt the model to emit the numbered middle, parse steps. */
async function viaChat(from: string, to: string, opts: PlanOpts): Promise<PlanStep[]> {
  const brain = brainFor(opts.model);
  const resp = await brain.complete({
    system: CHAT_SYSTEM,
    messages: [{ role: 'user', text: chatUser(from, to, opts.steps) }],
    tools: [],
  });
  return parseSteps(resp.text);
}

/**
 * Fill the plan between `from` (current state) and `to` (desired state).
 * mode 'fim' → FIM only; 'chat' → chat only; 'auto' (default) → FIM then chat fallback.
 * Throws if no steps could be produced by the selected mechanism(s).
 */
export async function planFeature(from: string, to: string, opts: PlanOpts): Promise<FeaturePlan> {
  const mode = opts.mode ?? 'auto';
  if (mode === 'fim' || mode === 'auto') {
    const steps = await viaFim(from, to, opts);
    if (steps) return { from, to, model: opts.model, mode: 'fim', steps, raw: stepsToText(steps) };
    if (mode === 'fim') throw new Error('FIM produced no steps (model may not support fill-in-the-middle)');
  }
  const steps = await viaChat(from, to, opts);
  if (!steps.length) throw new Error('planner produced no steps');
  return { from, to, model: opts.model, mode: 'chat', steps, raw: stepsToText(steps) };
}

function stepsToText(steps: PlanStep[]): string {
  return steps.map((s) => `${s.n}. ${s.title}${s.detail ? '\n   ' + s.detail.replace(/\n/g, '\n   ') : ''}`).join('\n');
}

/** Render a plan as markdown (the default human output + `--out` file content). */
export function renderMarkdown(plan: FeaturePlan): string {
  const lines = [
    '# Feature plan',
    '',
    `_${plan.steps.length} steps · model ${plan.model} · ${plan.mode}_`,
    '',
    '## Current state',
    '',
    plan.from.trim(),
    '',
    '## Desired state',
    '',
    plan.to.trim(),
    '',
    '## Steps',
    '',
  ];
  for (const s of plan.steps) {
    lines.push(`${s.n}. **${s.title}**`);
    if (s.detail) lines.push('', `   ${s.detail.replace(/\n/g, '\n   ')}`, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
