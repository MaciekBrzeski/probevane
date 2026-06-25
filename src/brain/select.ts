import type { Brain } from './brain.js';
import { anthropicBrain } from './anthropic-sdk.js';
import { openaiCompatBrain } from './openai-compat.js';

// Resolve a model id to a brain. `local:<id>` (or a PROBEVANE_BASE_URL pointing
// at a local server) → OpenAI-compatible backend; otherwise the Anthropic brain.
export function brainFor(model?: string): Brain {
  if (model?.startsWith('local:')) return openaiCompatBrain(model.slice('local:'.length));
  if (model?.startsWith('openai:')) return openaiCompatBrain(model.slice('openai:'.length));
  return anthropicBrain(model);
}
