import type { Brain } from './brain.js';
import { anthropicBrain } from './anthropic-sdk.js';
import { openaiCompatBrain } from './openai-compat.js';
import { claudeCodeBrain } from './claude-code.js';
import { bridgeBrain } from './bridge.js';
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

/** Resolve a model id (non-replay) to its base brain. */
function resolveBrain(model?: string): Brain {
  if (model === 'bridge') return bridgeBrain();
  if (model === 'claude-code') return claudeCodeBrain();
  if (model?.startsWith('cc:')) return claudeCodeBrain(model.slice('cc:'.length));
  if (model?.startsWith('local:')) return openaiCompatBrain(model.slice('local:'.length));
  if (model?.startsWith('openai:')) return openaiCompatBrain(model.slice('openai:'.length));
  return anthropicBrain(model && model !== 'auto' ? (ALIAS[model] ?? model) : undefined);
}

export function brainFor(model?: string): Brain {
  if (model?.startsWith('replay:')) return replayBrain(model.slice('replay:'.length));
  const brain = resolveBrain(model);
  const rec = process.env.PROBEVANE_RECORD;
  return rec ? recordingBrain(brain, rec) : brain;
}
