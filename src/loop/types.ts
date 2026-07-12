// Provider-neutral transcript + tool types. The brain maps these to/from its
// provider wire format (anthropic-sdk.ts), so the engine never imports a vendor SDK.

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

/** One tool invocation as the brain requested it; `id` ties the result back to the call. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** The outcome fed back for a ToolCall; isError carries gate blocks and tool failures alike. */
export interface ToolResult {
  id: string; // matches ToolCall.id
  content: string;
  isError: boolean;
}

/** One transcript entry. Assistant turns may carry tool calls; user turns may
 *  carry tool results (the outputs of the previous assistant's tool calls). */
export interface Msg {
  role: 'user' | 'assistant';
  text?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

/** Why the provider stopped generating, normalized across providers. */
export type StopReason = 'tool_use' | 'end_turn' | 'max_tokens' | 'other';

/** One completion: text and/or tool calls, plus the usage the engine folds into the cost ledger. */
export interface BrainResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number; costUsd?: number };
}
