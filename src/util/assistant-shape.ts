// Wire shape of the conversational assistant — a pure-type leaf shared by the
// daemon driver (node) and the control-center Chat tab (DOM), so the UI tsconfig
// doesn't pull node-only imports (same pattern as checks-shape.ts).

/** One ranked to-do carried into the chat as context / a follow-up card. */
export interface AssistantPlanItem {
  action: string; // generate | refactor | fix | mfe-fix
  target: string;
  why: string;
  priority: number;
}

/** The launch body the Chat tab POSTs to /run to start the interpreted run. */
export interface AssistantLaunch {
  op: string;
  dir: string;
  flags: string[];
}

/** interpret() result — the plan the user confirms before the run starts. */
export interface Interpretation {
  ok: boolean;
  error?: string; // set (with ok:false) when the dir is unusable / classify fails
  prompt: string;
  summary: string; // one-line human read of what will run
  op: string; // the resolved CLI op (generate/refactor/feature/…)
  kind: 'unit' | 'e2e';
  only?: string; // single-file scope, when inferred
  confidence: number; // 0..1 keyword-match confidence for the path
  assumptions: string[]; // e.g. "assumed unit tests — say 'e2e' to change"
  launch: AssistantLaunch; // ready to POST to /run (model overridable in the card)
  planContext: AssistantPlanItem[]; // the $0 plan signals as pre-run context
}

/** One improvement the assistant proposes after a run — a runnable next request. */
export interface Proposal {
  title: string;
  why: string;
  op: string;
  flags: string[];
  source: 'plan' | 'pyramid' | 'crowding' | 'quality';
}
