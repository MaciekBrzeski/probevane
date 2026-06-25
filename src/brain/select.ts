import type { Brain } from './brain.js';
import { anthropicBrain } from './anthropic-sdk.js';
import { openaiCompatBrain } from './openai-compat.js';
import { recordingBrain, replayBrain } from './replay.js';

// Resolve a model id to a brain.
//   replay:<file>  → replay from a cassette (deterministic, offline)
//   local:<id> / openai:<id> → OpenAI-compatible backend
//   else → Anthropic brain
// PROBEVANE_RECORD=<file> wraps any live brain to record a cassette.
const ALIAS: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
};

export function brainFor(model?: string): Brain {
  let brain: Brain;
  if (model?.startsWith('replay:')) return replayBrain(model.slice('replay:'.length));
  else if (model?.startsWith('local:')) brain = openaiCompatBrain(model.slice('local:'.length));
  else if (model?.startsWith('openai:')) brain = openaiCompatBrain(model.slice('openai:'.length));
  else brain = anthropicBrain(model && model !== 'auto' ? (ALIAS[model] ?? model) : undefined);

  const rec = process.env.PROBEVANE_RECORD;
  return rec ? recordingBrain(brain, rec) : brain;
}
