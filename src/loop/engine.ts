import type { Brain } from '../brain/brain.js';
import type { StackAdapter } from '../adapters/adapter.js';
import { RunCtx } from './ctx.js';
import type { Rune } from './rune.js';
import { firstBlockBefore, firstBlockStop } from './rune.js';
import { TOOL_SPECS, execTool } from './tools.js';
import { capOutput } from '../util/exec.js';
import type { Msg, ToolResult } from './types.js';
import { formatEvent } from './events.js';
import { isCircular, proposal as difficultyProposal } from './difficulty.js';
import { extractTestBlock } from './extract.js';
import { headSha } from '../util/git.js';
import { recordRun } from '../cost/ledger.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Turns to keep full tool_result bodies; older ones are pruned to a stub so the
// transcript (re-sent every turn) stays bounded. The files persist on disk —
// the model can re-read if it needs them.
const PRUNE_TOOL_RESULTS_AFTER = 8;

// Index marking the end of the STABLE (already-pruned) transcript prefix, for the
// brain's second cache_control breakpoint. The live window is ~2 messages per
// turn (assistant + tool_results), so everything before `len - liveWindow` is
// stubbed and immutable → safe to cache. Returns undefined when the transcript is
// still too short to have a stable prefix worth caching.
export function stableCacheIndex(
  len: number,
  liveWindowMsgs = PRUNE_TOOL_RESULTS_AFTER * 2,
): number | undefined {
  const idx = len - liveWindowMsgs - 1;
  return idx > 0 ? idx : undefined;
}

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
}

const BASE_SYSTEM = `You are probevane, an agent that edits a codebase to satisfy a task.
You work by calling tools. Read the relevant files first, record a plan, then make the change.
Follow the project's existing conventions. The specific rules for this task (what you may edit,
what must stay green) are stated below. When you believe the work is complete and the gates will
pass, STOP CALLING TOOLS and give a one-paragraph summary; the gates then verify.`;

// Focused system for small NON-tool-calling local models (minimalSystem mode):
// the full BASE_SYSTEM + every gate's systemPromptAddition is an instruction wall
// that makes a 3B model emit nothing usable. Strip it to the one thing it must do;
// the GATES still verify and feed failures back (the model learns from feedback,
// not upfront rules).
const MINIMAL_SYSTEM = `You write ONE test file for the task below.
Use ONLY the symbols listed in GROUND TRUTH. Assert concrete values; cover edge and error cases.
Output the COMPLETE test file as a SINGLE fenced code block (start it with a \`// <path>\` comment) and NOTHING else — no prose.
If a gate reports a failure, fix THAT failure and output the full file again.`;

export async function runLoop(opts: RunOptions): Promise<RunOutcome> {
  const { workdir, adapter, runes, task } = opts;
  const maxSteps = opts.maxSteps ?? 24;
  const forceStopAfter = opts.forceStopAfter ?? 6;
  const consultAfter = opts.consultAfter ?? Math.max(2, forceStopAfter - 3);
  // Read-thrash nudge: fire EARLY (after a handful of non-edit turns) so a run
  // that's crawling the repo gets pushed to plan+edit while it still has budget,
  // before the never-edited hard stop. Always < forceStopAfter.
  const nudgeAfter = Math.max(3, Math.min(6, forceStopAfter - 1));
  const log = opts.log ?? (() => {});

  let brain = opts.brain; // mutable: the consult ladder can swap in a stronger brain
  let tookOver = false;
  let consulted = false;
  let nudged = false;

  const ctx = new RunCtx(workdir, adapter, task);

  // Assemble system prompt. Minimal mode (small local models): focused system,
  // SKIP the gate systemPromptAdditions (instruction wall) — but still run
  // prepare() for its side-effects (e.g. validation_gate captures the baseline
  // type-error count there) and discard the returned text. Full mode: base + all.
  let system = opts.minimalSystem ? MINIMAL_SYSTEM : BASE_SYSTEM;
  if (!opts.minimalSystem) {
    for (const r of runes) {
      const add = r.systemPromptAddition?.(ctx);
      if (add) system += '\n\n' + add;
    }
  }
  for (const r of runes) {
    const add = await r.prepare?.(ctx);
    if (add && !opts.minimalSystem) system += '\n\n' + add;
  }

  const messages: Msg[] = [{ role: 'user', text: task }];
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead = 0;
  let costUsd = 0; // brain-reported actual cost (claude-code), when available

  // Live event log — one JSON line per step to <workdir>/.probevane/events-<runId>.jsonl,
  // tailed by `probevane serve`/`peek`. On by default; opt out with PROBEVANE_EVENTS=0.
  const runId = opts.runId ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  ctx.runId = runId; // unique per run — diary/events key on it (no cross-run collision)
  // Safety net: record HEAD before we edit, so `probevane revert <runId>` can roll
  // the run's touched files back (no-op outside a git repo).
  ctx.checkpointSha = await headSha(workdir).catch(() => '');
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
  let proposalText: string | undefined;
  let lastExtract: string | undefined; // last text-extracted spec (dedup → converge to stop gates)
  let exemplarShown = false; // selective retrieval: inject a similar exemplar once, on first stop-block

  while (ctx.step < maxSteps) {
    ctx.step++;
    for (const r of runes) await r.onTurnStart?.(ctx);

    let resp;
    try {
      resp = await brain.complete({
        system,
        messages,
        tools: TOOL_SPECS,
        // Kill-switch (A/B + escape hatch): PROBEVANE_NO_TRANSCRIPT_CACHE=1 keeps
        // only the system/tools cache breakpoint, re-billing the transcript.
        cachePrefixIndex:
          process.env.PROBEVANE_NO_TRANSCRIPT_CACHE === '1'
            ? undefined
            : stableCacheIndex(messages.length),
      });
    } catch (e) {
      log(`[engine] brain error: ${String(e)}`);
      stopReason = 'error';
      break;
    }
    tokensIn += resp.usage.input;
    tokensOut += resp.usage.output;
    cacheRead += resp.usage.cacheRead ?? 0;
    costUsd += resp.usage.costUsd ?? 0;
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
      // Text-extract fallback: a non-tool-calling local model emits the test as a
      // fenced code block in prose. Treat a NEW block as a write (synthesize the
      // write_file call so it runs through the gates); a REPEATED/identical block
      // means the model is done → fall through to the stop gates so it can accept.
      let handledAsWrite = false;
      if (opts.textExtract && resp.text) {
        const ex = extractTestBlock(resp.text);
        if (ex && ex.code !== lastExtract) {
          const path = ex.path ?? opts.specPathHint;
          if (path) {
            lastExtract = ex.code;
            if (!ctx.plan) ctx.plan = { text: 'auto (text-extract): write the extracted spec', at: ctx.step };
            const call = { id: `extract-${ctx.step}`, name: 'write_file', input: { path, contents: ex.code } };
            ctx.noteCall(call);
            const decision = await firstBlockBefore(runes, call, ctx);
            if (decision.kind === 'block') {
              ctx.gateBlocks++; ctx.barren++; ctx.noteBlock(decision.reason);
              messages.push({ role: 'assistant', toolCalls: [call] });
              messages.push({ role: 'user', toolResults: [{ id: call.id, content: decision.inject ?? decision.reason, isError: true }] });
              log(`[engine]   text-extract write BLOCKED: ${decision.reason}`);
            } else {
              const out = capOutput(await execTool(call, ctx));
              for (const r of runes) await r.afterToolCall?.(call, { id: call.id, content: out, isError: false }, ctx);
              messages.push({ role: 'assistant', toolCalls: [call] });
              messages.push({ role: 'user', toolResults: [{ id: call.id, content: out, isError: false }] });
              ctx.barren = 0;
              log(`[engine]   text-extract: wrote ${path}`);
            }
            handledAsWrite = true;
          } else {
            ctx.barren++;
            messages.push({ role: 'user', text: 'You wrote a code block but named no file. Start it with a `// <relative/path>` comment, or call the write_file tool.' });
            handledAsWrite = true;
          }
        }
      }

      if (!handledAsWrite) {
        // Model wants to stop → run should_stop gates.
        const decision = await firstBlockStop(runes, ctx);
        if (decision.kind === 'block') {
          ctx.gateBlocks++;
          ctx.barren++;
          ctx.noteBlock(decision.reason);
          log(`[engine]   stop BLOCKED: ${decision.reason}`);
          let inject = decision.inject ?? decision.reason;
          // Selective retrieval (fourier-nca: failures-only +5.5%, blanket = 0):
          // on the FIRST stop-block after an edit, surface the most-similar accepted
          // exemplar alongside the gate feedback. Once per run, only if one matches.
          if (!exemplarShown && ctx.editedFiles.size > 0 && opts.onConsult) {
            exemplarShown = true;
            const ex = await opts.onConsult(ctx).catch(() => undefined);
            if (ex) { inject += `\n\nA passing test for a SIMILAR module (adapt its approach):\n${ex}`; log('[engine]   + similar exemplar injected'); }
          }
          messages.push({ role: 'user', text: inject });
        } else {
          accepted = true;
          stopReason = 'accepted';
          log('[engine]   ACCEPTED (all gates green)');
          break;
        }
      }
    }

    // Escalation only counts AFTER the first productive edit — initial reading /
    // planning is legitimate non-edit work, not a stall (runestone's force_stop
    // lesson: don't fire during the read/plan phase).
    const started = ctx.editedFiles.size > 0;

    // Read-thrash nudge: a run that keeps READING and never edits (the large-repo
    // refactor stall — distinct read_file calls never look "circular", so the
    // never-edited stop alone would let it churn to max_steps). Push it to commit
    // ONCE, early, while it still has turns left. Reads/plans both grow `barren`
    // until the first edit, so barren == non-edit turns here.
    if (!started && !nudged && ctx.barren >= nudgeAfter) {
      nudged = true;
      messages.push({
        role: 'user',
        text:
          `You have taken ${ctx.step} turns reading without editing any file. You have enough ` +
          `context now. STOP reading other files. Call \`plan\` (if you haven't), then make your ` +
          `\`edit_file\`/\`write_file\` changes to the target. The test suite will verify correctness — ` +
          `commit the edit; do not keep exploring.`,
      });
      log(`[engine] read-thrash nudge: ${ctx.barren} non-edit turns — pushing to plan+edit`);
      continue;
    }

    // Never-edited stall: a run with ZERO edits after forceStopAfter non-edit turns
    // is stalled — a weak model emitting prose instead of write_file, OR a strong
    // model over-reading a large repo (distinct reads never trip isCircular). Fire
    // deterministically on barren-without-edit; don't also require circularity
    // (that let big-repo refactors churn all the way to max_steps). Deterministic
    // proposal only (the run must stay free / replayable).
    if (!started && ctx.barren >= forceStopAfter) {
      proposalText =
        `No test file produced in ${ctx.step} turns — the model isn't writing files ` +
        `(it may not support tool calls, or the target is too hard for it). ` +
        difficultyProposal(ctx);
      log(`[engine] difficulty (never-edited): stopping early — ${proposalText.split('—')[0].trim()}`);
      stopReason = 'difficulty';
      break;
    }

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
      // Skip the exemplar here if already surfaced on the first block (no blanket
      // re-injection — fourier: blanket retrieval is noise).
      if (!exemplarShown) {
        const extra = await opts.onConsult?.(ctx).catch(() => undefined);
        if (extra) { msg += `\n\nHELP:\n${extra}`; exemplarShown = true; }
      }
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

    // Difficulty gate: once we've already escalated (consulted/took over) and the
    // loop is still CIRCLING — same gate-block reason or identical tool call ≥3× —
    // stop early and PROPOSE a way forward instead of burning the rest of the
    // budget churning. Deterministic proposal first; one LLM proposal turn appended
    // when there's budget headroom (skipped in deterministic/replay mode).
    if (started && consulted && isCircular(ctx)) {
      proposalText = difficultyProposal(ctx);
      const outOfBudget = opts.budget ? tokensOut >= opts.budget : false;
      if (!outOfBudget && process.env.PROBEVANE_DETERMINISTIC !== '1') {
        try {
          messages.push({
            role: 'user',
            text:
              `${proposalText}\n\nYou appear stuck. In <=5 lines, propose a simpler target or ` +
              `explain the exact blocker. Do NOT call tools.`,
          });
          const r = await brain.complete({
            system, messages, tools: TOOL_SPECS, cachePrefixIndex: stableCacheIndex(messages.length),
          });
          tokensIn += r.usage.input;
          tokensOut += r.usage.output;
          cacheRead += r.usage.cacheRead ?? 0;
          costUsd += r.usage.costUsd ?? 0;
          if (r.text.trim()) proposalText += `\n\nModel: ${r.text.trim()}`;
        } catch { /* deterministic proposal still stands */ }
      }
      log(`[engine] difficulty: stopping + proposing — ${proposalText.split('\n')[0]}`);
      stopReason = 'difficulty';
      break;
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
  emit({ stopReason, accepted, proposal: proposalText });
  if (proposalText) log(`[engine] PROPOSAL:\n${proposalText}`);
  await recordRun({
    ts: new Date().toISOString(), runId, label: opts.label ?? 'run', model: brain.model,
    tokensIn, tokensOut, cacheRead, accepted, tookOver, stopReason, steps: ctx.step,
    costUsd: costUsd || undefined,
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
    proposal: proposalText,
  };
}
