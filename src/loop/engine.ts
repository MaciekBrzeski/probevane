import type { Brain } from '../brain/brain.js';
import type { StackAdapter } from '../adapters/adapter.js';
import { RunCtx } from './ctx.js';
import type { Rune } from './rune.js';
import { firstBlockBefore, firstBlockStop } from './rune.js';
import { TOOL_SPECS, execTool } from './tools.js';
import { capOutput } from '../util/exec.js';
import type { Msg, ToolResult } from './types.js';
import { formatEvent } from './events.js';
import { recordRun } from '../cost/ledger.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Turns to keep full tool_result bodies; older ones are pruned to a stub so the
// transcript (re-sent every turn) stays bounded. The files persist on disk —
// the model can re-read if it needs them.
const PRUNE_TOOL_RESULTS_AFTER = 8;

function pruneOldToolResults(messages: Msg[], keepLast: number): void {
  // Find user turns carrying tool results, oldest first; stub all but the last `keepLast`.
  const idxs = messages.flatMap((m, i) => (m.toolResults?.length ? [i] : []));
  const cutoff = idxs.length - keepLast;
  for (let k = 0; k < cutoff; k++) {
    const m = messages[idxs[k]];
    if (!m.toolResults) continue;
    m.toolResults = m.toolResults.map((r) =>
      r.content === '[pruned]' ? r : { ...r, content: '[pruned — re-read the file if needed]' },
    );
  }
}

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
  /** Stronger model to take over a bounded window when stuck (optional). */
  takeoverBrain?: Brain;
  /** Extra guidance pulled when stuck (e.g. a library exemplar). */
  onConsult?: (ctx: RunCtx) => Promise<string | undefined>;
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
  stopReason: 'accepted' | 'max_steps' | 'stuck' | 'error' | 'budget';
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  tookOver: boolean;
}

const BASE_SYSTEM = `You are probevane, an agent that edits a codebase to satisfy a task.
You work by calling tools. Read the relevant files first, record a plan, then make the change.
Follow the project's existing conventions. The specific rules for this task (what you may edit,
what must stay green) are stated below. When you believe the work is complete and the gates will
pass, STOP CALLING TOOLS and give a one-paragraph summary; the gates then verify.`;

export async function runLoop(opts: RunOptions): Promise<RunOutcome> {
  const { workdir, adapter, runes, task } = opts;
  const maxSteps = opts.maxSteps ?? 24;
  const forceStopAfter = opts.forceStopAfter ?? 6;
  const consultAfter = opts.consultAfter ?? Math.max(2, forceStopAfter - 3);
  const log = opts.log ?? (() => {});

  let brain = opts.brain; // mutable: the consult ladder can swap in a stronger brain
  let tookOver = false;
  let consulted = false;

  const ctx = new RunCtx(workdir, adapter, task);

  // Assemble system prompt: base + rune static additions + async prepare().
  let system = BASE_SYSTEM;
  for (const r of runes) {
    const add = r.systemPromptAddition?.(ctx);
    if (add) system += '\n\n' + add;
  }
  for (const r of runes) {
    const add = await r.prepare?.(ctx);
    if (add) system += '\n\n' + add;
  }

  const messages: Msg[] = [{ role: 'user', text: task }];
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead = 0;

  // Live event log — one JSON line per step to <workdir>/.probevane/events-<runId>.jsonl,
  // tailed by `probevane serve`/`peek`. On by default; opt out with PROBEVANE_EVENTS=0.
  const runId = opts.runId ?? `run-${Date.now().toString(36)}`;
  const eventsOn = process.env.PROBEVANE_EVENTS !== '0';
  const eventsPath = join(workdir, '.probevane', `events-${runId}.jsonl`);
  if (eventsOn) mkdirSync(join(workdir, '.probevane'), { recursive: true });
  const emit = (extra: Record<string, unknown>) => {
    if (!eventsOn) return;
    try {
      appendFileSync(
        eventsPath,
        formatEvent({
          ts: new Date().toISOString(), runId, step: ctx.step,
          toolCalls: ctx.toolCalls, gateBlocks: ctx.gateBlocks, gateBlockReasons: ctx.gateBlockReasons,
          tokensIn, tokensOut, editedFiles: [...ctx.editedFiles], ...extra,
        }) + '\n',
      );
    } catch { /* observability is best-effort */ }
  };
  let accepted = false;
  let stopReason: RunOutcome['stopReason'] = 'max_steps';

  while (ctx.step < maxSteps) {
    ctx.step++;
    for (const r of runes) await r.onTurnStart?.(ctx);

    let resp;
    try {
      resp = await brain.complete({ system, messages, tools: TOOL_SPECS });
    } catch (e) {
      log(`[engine] brain error: ${String(e)}`);
      stopReason = 'error';
      break;
    }
    tokensIn += resp.usage.input;
    tokensOut += resp.usage.output;
    cacheRead += resp.usage.cacheRead ?? 0;
    log(
      `[engine] step ${ctx.step}: ${resp.toolCalls.length} tool call(s)${resp.text ? ' + text' : ''}` +
        `${resp.usage.cacheRead ? ` [cache hit ${resp.usage.cacheRead}]` : ''}`,
    );
    emit({ tool: resp.toolCalls[0]?.name });

    messages.push({ role: 'assistant', text: resp.text || undefined, toolCalls: resp.toolCalls });

    if (resp.toolCalls.length > 0) {
      const results: ToolResult[] = [];
      let productive = false;
      for (const call of resp.toolCalls) {
        ctx.noteCall(call);
        const decision = await firstBlockBefore(runes, call, ctx);
        if (decision.kind === 'block') {
          ctx.gateBlocks++;
          ctx.noteBlock(decision.reason);
          results.push({ id: call.id, content: decision.inject ?? decision.reason, isError: true });
          log(`[engine]   ${call.name} BLOCKED: ${decision.reason}`);
          continue;
        }
        try {
          const out = capOutput(await execTool(call, ctx));
          for (const r of runes) await r.afterToolCall?.(call, { id: call.id, content: out, isError: false }, ctx);
          results.push({ id: call.id, content: out, isError: false });
          if (call.name === 'write_file' || call.name === 'edit_file' || call.name === 'delete_file')
            productive = true;
          log(`[engine]   ${call.name} ok`);
        } catch (e) {
          results.push({ id: call.id, content: String(e), isError: true });
          log(`[engine]   ${call.name} error: ${String(e)}`);
        }
      }
      ctx.barren = productive ? 0 : ctx.barren + 1;
      messages.push({ role: 'user', toolResults: results });
      pruneOldToolResults(messages, PRUNE_TOOL_RESULTS_AFTER);
    } else {
      // Model wants to stop → run should_stop gates.
      const decision = await firstBlockStop(runes, ctx);
      if (decision.kind === 'block') {
        ctx.gateBlocks++;
        ctx.barren++;
        ctx.noteBlock(decision.reason);
        log(`[engine]   stop BLOCKED: ${decision.reason}`);
        messages.push({ role: 'user', text: decision.inject ?? decision.reason });
      } else {
        accepted = true;
        stopReason = 'accepted';
        log('[engine]   ACCEPTED (all gates green)');
        break;
      }
    }

    // Escalation only counts AFTER the first productive edit — initial reading /
    // planning is legitimate non-edit work, not a stall (runestone's force_stop
    // lesson: don't fire during the read/plan phase).
    const started = ctx.editedFiles.size > 0;

    // Consult ladder: when stalled, escalate once before giving up. Pull extra
    // guidance (e.g. a library exemplar via onConsult), nudge toward finish/cleanup,
    // and — if a stronger brain is supplied — hand it the window (takeover).
    if (started && ctx.barren >= consultAfter && !consulted) {
      consulted = true;
      ctx.barren = 0;
      let msg =
        `You have made ${consultAfter} turns with no productive change. Re-read the latest gate ` +
        `feedback above. If you believe the tests are complete, STOP CALLING TOOLS so the gates can ` +
        `run. If a test file is empty or a leftover, delete_file it. Do not keep reading.`;
      const extra = await opts.onConsult?.(ctx).catch(() => undefined);
      if (extra) msg += `\n\nHELP:\n${extra}`;
      if (opts.takeoverBrain) {
        brain = opts.takeoverBrain;
        tookOver = true;
        msg += `\n\n(A stronger model is now assisting; resolve the gate failures decisively.)`;
        log(`[engine] consult: TAKEOVER by ${brain.model}`);
      } else {
        log('[engine] consult: injecting extra guidance');
      }
      messages.push({ role: 'user', text: msg });
      continue;
    }

    if (started && ctx.barren >= forceStopAfter) {
      log(`[engine] giving up: ${ctx.barren} barren turns (forceStopAfter=${forceStopAfter})`);
      stopReason = 'stuck';
      break;
    }

    // Hard cost ceiling — never let a stuck loop drain the budget.
    if (opts.budget && tokensOut >= opts.budget) {
      log(`[engine] budget reached: ${tokensOut} >= ${opts.budget} output tokens`);
      stopReason = 'budget';
      break;
    }
  }

  ctx.accepted = accepted;
  ctx.stopReason = stopReason;
  emit({ stopReason, accepted });
  await recordRun({
    ts: new Date().toISOString(), runId, label: opts.label ?? 'run', model: brain.model,
    tokensIn, tokensOut, cacheRead, accepted, tookOver, stopReason, steps: ctx.step,
  });
  for (const r of runes) await r.onStop?.(ctx);

  return {
    accepted,
    steps: ctx.step,
    toolCalls: ctx.toolCalls,
    gateBlocks: ctx.gateBlocks,
    stopReason,
    tokensIn,
    tokensOut,
    cacheRead,
    tookOver,
  };
}
