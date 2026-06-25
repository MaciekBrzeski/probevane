import type { Msg, ToolSpec, BrainResponse } from '../loop/types.js';

// The LLM driver abstraction (fourier AGENT.md "brain slot"). The engine talks
// only to this; swapping anthropic-sdk for claude-code (or a takeover model)
// touches nothing in the loop.
export interface BrainRequest {
  system: string;
  messages: Msg[];
  tools: ToolSpec[];
}

export interface Brain {
  id: string;
  model: string;
  complete(req: BrainRequest): Promise<BrainResponse>;
}
