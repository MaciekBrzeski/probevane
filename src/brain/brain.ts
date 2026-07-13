import type { Msg, ToolSpec, BrainResponse } from '../loop/types.js';

// The LLM driver abstraction (fourier AGENT.md "brain slot"). The engine talks
// only to this; swapping anthropic-sdk for claude-code (or a takeover model)
// touches nothing in the loop.
export interface BrainRequest {
  system: string;
  messages: Msg[];
  tools: ToolSpec[];
  /**
   * Index into `messages` marking the end of the STABLE transcript prefix
   * (everything at or before it has been pruned to a stub and will never change
   * again). A brain may set a second cache_control breakpoint on that message so
   * the growing transcript is read from cache instead of re-billed each turn.
   * Undefined → cache only the system+tools prefix (the old behaviour).
   */
  cachePrefixIndex?: number;
  /**
   * Optional live-token sink. When set (and the backend streams), the brain calls
   * this with throttled text chunks as they arrive — the engine wires it to the
   * event log for live display. Only the anthropic backend streams; others ignore it.
   */
  onDelta?: (text: string) => void;
}

/** A pluggable LLM driver: `id`/`model` label the backend for the ledger and
 *  logs; `complete()` turns one BrainRequest into one BrainResponse. Filled by
 *  the factories in anthropic-sdk / claude-code / openai-compat / bridge /
 *  replay; select.ts picks one from the --model string. */
export interface Brain {
  id: string;
  model: string;
  complete(req: BrainRequest): Promise<BrainResponse>;
}
