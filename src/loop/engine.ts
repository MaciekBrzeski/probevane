import type { Brain } from '../brain/brain.js';
import type { StackAdapter } from '../adapters/adapter.js';
import { RunCtx } from './ctx.js';
import type { Rune } from './rune.js';
import type { Msg } from './types.js';
import { headSha } from '../util/git.js';
import { recordRun } from '../cost/ledger.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assembleSystem,
  appendTranscript,
  emit,
  runStep,
  stableCacheIndex,
  type LoopRun,
  type LoopState,
} from './engine-phases.js';
import { userTurn } from './transcript.js';
import {
  nudgeCheck,
  neverEditedCheck,
  consultCheck,
  difficultyCheck,
  stuckCheck,
  budgetCheck,
} from './engine-escalation.js';

// Re-exported for API compatibility (the engine's only consumer of stableCacheIndex
// is the phase module; kept exported here so the public surface is unchanged).
export { stableCacheIndex };

// The gated agent loop — ported from runestone engine.rs::run_loop.
//   act → before_tool_call gates → run → if model stops, should_stop gates →
//   block injects feedback + continue / allow accepts.

export interface RunOptions {
  workdir: string;
  adapter: StackAdapter;
  brain: Brain;
  runes: Rune[];
  task: string;
  maxSteps?: number;
  forceStopAfter?: number; // barren-turn ceiling before giving up
  budget?: number; // hard ceiling on output tokens — stop (budget) when exceeded
  consultAfter?: number; // barren turns before the consult/takeover escalation
  consultAtStep?: number; // step-based escalation: consult/takeover once a STARTED run passes this step while still failing gates (rescues edit-happy thrashers whose `barren` never grows — the barren ladder's blind spot)
  /** Stronger model to take over a bounded window when stuck (optional). */
  takeoverBrain?: Brain;
  /** Extra guidance pulled when stuck (e.g. a library exemplar). */
  onConsult?: (ctx: RunCtx) => Promise<string | undefined>;
  /** Accept a fenced code block in the model's prose as a write (non-tool-calling local models). */
  textExtract?: boolean;
  /** Focused system prompt (skip the gate instruction-wall) for small local models. */
  minimalSystem?: boolean;
  /** Fallback spec path when an extracted block names none (single-target runs). */
  specPathHint?: string;
  /** Stable id for the live event log file (defaults to a timestamp id). */
  runId?: string;
  /** Human label for the cost ledger, e.g. "generate:fixtures/x" (path:target). */
  label?: string;
  log?: (line: string) => void;
}

export interface RunOutcome {
  accepted: boolean;
  steps: number;
  toolCalls: number;
  gateBlocks: number;
  stopReason: 'accepted' | 'max_steps' | 'stuck' | 'error' | 'budget' | 'difficulty';
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  tookOver: boolean;
  /** Set when stopReason is "difficulty": what blocked + suggested next steps. */
  proposal?: string;
  /** Suite signals captured by the gates (no extra run) — for `generate --report`. */
  tests?: number;
  coverage?: number;
  /** Project-relative paths the run wrote/edited (for ship + worktree commit). */
  editedFiles: string[];
}

const READ_BUDGET = 5; // pre-edit read_file/list_dir calls before we push to commit

// Build the per-run state bag: tuning constants, fresh RunCtx, assembled system
// prompt, initial transcript, event-log wiring, and the mutable LoopState.
async function createLoopRun(opts: RunOptions): Promise<LoopRun> {
  const { workdir, adapter, runes, task } = opts;
  const maxSteps = opts.maxSteps ?? 24;
  const forceStopAfter = opts.forceStopAfter ?? 6;
  const consultAfter = opts.consultAfter ?? Math.max(2, forceStopAfter - 3);
  // Step-based escalation: an edit-happy model that keeps failing gates never
  // grows `barren` (every turn resets it), so the barren ladder never rescues it.
  // Once a STARTED run passes ~60% of its step budget while still blocking on
  // gates, escalate anyway (consult/takeover). Absolute floor keeps it firing
  // before max_steps on small budgets too.
  const consultAtStep = opts.consultAtStep ?? Math.max(consultAfter + 2, Math.floor(maxSteps * 0.6));
  // Read-thrash nudge fires EARLY (a handful of non-edit turns), always < forceStopAfter.
  const nudgeAfter = Math.max(3, Math.min(6, forceStopAfter - 1));
  const log = opts.log ?? (() => {});

  const ctx = new RunCtx(workdir, adapter, task);
  const system = await assembleSystem(opts, runes, ctx);
  const messages: Msg[] = [{ role: 'user', text: task }];

  // Live event log → <workdir>/.probevane/events-<runId>.jsonl (PROBEVANE_EVENTS=0 disables).
  const runId = opts.runId ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  ctx.runId = runId; // unique per run — diary/events key on it (no cross-run collision)
  // Safety net: record HEAD before we edit, so `probevane revert <runId>` can roll back.
  ctx.checkpointSha = await headSha(workdir).catch(() => '');
  const eventsOn = process.env.PROBEVANE_EVENTS !== '0';
  const eventsPath = join(workdir, '.probevane', `events-${runId}.jsonl`);
  // Full transcript log → <workdir>/.probevane/transcript-<runId>.jsonl (PROBEVANE_TRANSCRIPT=0 disables).
  const transcriptOn = process.env.PROBEVANE_TRANSCRIPT !== '0';
  const transcriptPath = join(workdir, '.probevane', `transcript-${runId}.jsonl`);
  if (eventsOn || transcriptOn) mkdirSync(join(workdir, '.probevane'), { recursive: true });

  const st: LoopState = {
    brain: opts.brain, tookOver: false, consulted: false, nudges: 0,
    accepted: false, stopReason: 'max_steps', proposalText: undefined,
    lastExtract: undefined, exemplarShown: false,
    tokensIn: 0, tokensOut: 0, cacheRead: 0, costUsd: 0,
  };
  return {
    opts, ctx, runes, messages, system, log, st,
    runId, eventsOn, eventsPath, transcriptOn, transcriptPath,
    maxSteps, forceStopAfter, consultAfter, consultAtStep, nudgeAfter, readBudget: READ_BUDGET,
  };
}

// Post-loop wrap-up: mirror the stop state onto ctx, emit the final event, record
// the run in the cost ledger, fire onStop hooks, and assemble the RunOutcome.
async function finalizeRun(lr: LoopRun): Promise<RunOutcome> {
  const { ctx, st, runes, opts, log, runId } = lr;
  ctx.accepted = st.accepted;
  ctx.stopReason = st.stopReason;
  emit(lr, { stopReason: st.stopReason, accepted: st.accepted, proposal: st.proposalText });
  if (st.proposalText) log(`[engine] PROPOSAL:\n${st.proposalText}`);
  await recordRun({
    ts: new Date().toISOString(), runId, label: opts.label ?? 'run', model: st.brain.model,
    tokensIn: st.tokensIn, tokensOut: st.tokensOut, cacheRead: st.cacheRead,
    accepted: st.accepted, tookOver: st.tookOver, stopReason: st.stopReason, steps: ctx.step,
    costUsd: st.costUsd || undefined,
  });
  for (const r of runes) await r.onStop?.(ctx);

  return {
    accepted: st.accepted,
    steps: ctx.step,
    toolCalls: ctx.toolCalls,
    gateBlocks: ctx.gateBlocks,
    stopReason: st.stopReason,
    tokensIn: st.tokensIn,
    tokensOut: st.tokensOut,
    cacheRead: st.cacheRead,
    tookOver: st.tookOver,
    proposal: st.proposalText,
    tests: ctx.lastRunPassed,
    coverage: ctx.lastCoverage,
    editedFiles: [...ctx.editedFiles],
  };
}

export async function runLoop(opts: RunOptions): Promise<RunOutcome> {
  const lr = await createLoopRun(opts);
  const { ctx } = lr;
  // Seed the transcript with the task (step 0) so the viewer opens with intent.
  appendTranscript(lr, userTurn(lr.runId, opts.task));

  while (ctx.step < lr.maxSteps) {
    if ((await runStep(lr)) === 'break') break;

    // Escalation only counts AFTER the first productive edit — initial reading /
    // planning is legitimate non-edit work, not a stall (runestone's force_stop
    // lesson: don't fire during the read/plan phase).
    const started = ctx.editedFiles.size > 0;

    if (nudgeCheck(lr, started)) continue;
    if (neverEditedCheck(lr, started)) break;
    if (await consultCheck(lr, started)) continue;
    if (await difficultyCheck(lr, started)) break;
    if (stuckCheck(lr, started)) break;
    if (budgetCheck(lr)) break;
  }

  return finalizeRun(lr);
}
