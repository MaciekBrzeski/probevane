import type { Brain } from '../brain/brain.js';
import type { StackAdapter } from '../adapters/adapter.js';
import { RunCtx } from './ctx.js';
import type { Rune } from './rune.js';
import { firstBlockBefore, firstBlockStop } from './rune.js';
import { TOOL_SPECS, execTool } from './tools.js';
import { capOutput } from '../util/exec.js';
import type { Msg, ToolResult, BrainResponse } from './types.js';
import { formatEvent } from './events.js';
import { buildTurn, formatTurn, type TranscriptTurn } from './transcript.js';
import { BASE_SYSTEM, MINIMAL_SYSTEM } from './engine-prompts.js';
import { extractTestBlock } from './extract.js';
import { appendFileSync } from 'node:fs';
import type { RunOptions, RunOutcome } from './engine.js';

// Turns to keep full tool_result bodies; older ones are pruned to a stub so the
// transcript (re-sent every turn) stays bounded. The files persist on disk —
// the model can re-read if it needs them.
export const PRUNE_TOOL_RESULTS_AFTER = 8;

// Mutable per-run state threaded through the phase helpers (the consult ladder can
// swap in a stronger brain; token/cost counters and stop signals accumulate here).
export interface LoopState {
  brain: Brain; // mutable: the consult ladder can swap in a stronger brain
  tookOver: boolean;
  consulted: boolean;
  nudges: number; // read-thrash nudges fired (escalates once before the never-edited stop)
  accepted: boolean;
  stopReason: RunOutcome['stopReason'];
  proposalText?: string;
  lastExtract?: string; // last text-extracted spec (dedup → converge to stop gates)
  exemplarShown: boolean; // selective retrieval: inject a similar exemplar once, on first stop-block
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  costUsd: number; // brain-reported actual cost (claude-code), when available
}

// Everything a phase helper needs: the run inputs, the live transcript, the event
// sink wiring, the tuning constants, and the mutable state bag.
export interface LoopRun {
  opts: RunOptions;
  ctx: RunCtx;
  runes: Rune[];
  messages: Msg[];
  system: string;
  log: (line: string) => void;
  st: LoopState;
  runId: string;
  eventsOn: boolean;
  eventsPath: string;
  maxSteps: number;
  forceStopAfter: number;
  consultAfter: number;
  consultAtStep: number;
  nudgeAfter: number;
  readBudget: number;
  transcriptOn: boolean;
  transcriptPath: string;
}

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

// Assemble system prompt. Minimal mode (small local models): focused system,
// SKIP the gate systemPromptAdditions (instruction wall) — but still run
// prepare() for its side-effects (e.g. validation_gate captures the baseline
// type-error count there) and discard the returned text. Full mode: base + all.
export async function assembleSystem(opts: RunOptions, runes: Rune[], ctx: RunCtx): Promise<string> {
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
  return system;
}

// Live event log — one JSON line per step. On by default; opt out with PROBEVANE_EVENTS=0.
export function emit(lr: LoopRun, extra: Record<string, unknown>): void {
  if (!lr.eventsOn) return;
  const { ctx, st } = lr;
  try {
    appendFileSync(
      lr.eventsPath,
      formatEvent({
        ts: new Date().toISOString(), runId: lr.runId, step: ctx.step,
        toolCalls: ctx.toolCalls, gateBlocks: ctx.gateBlocks, gateBlockReasons: ctx.gateBlockReasons,
        tokensIn: st.tokensIn, tokensOut: st.tokensOut, editedFiles: [...ctx.editedFiles], ...extra,
      }) + '\n',
    );
  } catch { /* observability is best-effort */ }
}

// Full transcript — append one turn to <workdir>/.probevane/transcript-<runId>.jsonl
// (best-effort, guarded by lr.transcriptOn). Verbatim: the transcript is never
// re-sent to the model, so it costs disk only, not tokens.
export function appendTranscript(lr: LoopRun, turn: TranscriptTurn): void {
  if (!lr.transcriptOn) return;
  try {
    appendFileSync(lr.transcriptPath, formatTurn(turn) + '\n');
  } catch { /* transcript is best-effort */ }
}

async function requestCompletion(lr: LoopRun): Promise<BrainResponse | null> {
  try {
    return await lr.st.brain.complete({
      system: lr.system,
      messages: lr.messages,
      tools: TOOL_SPECS,
      // Kill-switch (A/B + escape hatch): PROBEVANE_NO_TRANSCRIPT_CACHE=1 keeps
      // only the system/tools cache breakpoint, re-billing the transcript.
      cachePrefixIndex:
        process.env.PROBEVANE_NO_TRANSCRIPT_CACHE === '1'
          ? undefined
          : stableCacheIndex(lr.messages.length),
      // Live tokens (opt-in): stream throttled deltas into the event log so
      // serve/peek/daemon can show partial output as it's generated.
      onDelta: process.env.PROBEVANE_STREAM_TOKENS === '1' ? (delta) => emit(lr, { delta }) : undefined,
    });
  } catch (e) {
    lr.log(`[engine] brain error: ${String(e)}`);
    lr.st.stopReason = 'error';
    return null;
  }
}

async function applyToolCalls(lr: LoopRun, resp: BrainResponse): Promise<ToolResult[]> {
  const { ctx, runes, messages, log } = lr;
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
  return results;
}

// Text-extract fallback: a non-tool-calling local model emits the test as a
// fenced code block in prose. Treat a NEW block as a write (synthesize the
// write_file call so it runs through the gates); a REPEATED/identical block
// means the model is done → fall through to the stop gates so it can accept.
// Returns true when the prose block was handled as a write (skip the stop gate).
async function tryTextExtract(lr: LoopRun, resp: BrainResponse): Promise<boolean> {
  const { opts, ctx, runes, messages, log, st } = lr;
  if (!opts.textExtract || !resp.text) return false;
  const ex = extractTestBlock(resp.text);
  if (!ex || ex.code === st.lastExtract) return false;
  const path = ex.path ?? opts.specPathHint;
  if (!path) {
    ctx.barren++;
    messages.push({ role: 'user', text: 'You wrote a code block but named no file. Start it with a `// <relative/path>` comment, or call the write_file tool.' });
    return true;
  }
  st.lastExtract = ex.code;
  if (!ctx.plan) ctx.plan = { text: 'auto (text-extract): write the extracted spec', at: ctx.step };
  const call = { id: `extract-${ctx.step}`, name: 'write_file', input: { path, contents: ex.code } };
  ctx.noteCall(call);
  const decision = await firstBlockBefore(runes, call, ctx);
  if (decision.kind === 'block') {
    ctx.gateBlocks++; ctx.barren++; ctx.noteBlock(decision.reason);
    messages.push({ role: 'assistant', toolCalls: [call] });
    messages.push({
      role: 'user',
      toolResults: [{ id: call.id, content: decision.inject ?? decision.reason, isError: true }],
    });
    log(`[engine]   text-extract write BLOCKED: ${decision.reason}`);
  } else {
    const out = capOutput(await execTool(call, ctx));
    for (const r of runes) await r.afterToolCall?.(call, { id: call.id, content: out, isError: false }, ctx);
    messages.push({ role: 'assistant', toolCalls: [call] });
    messages.push({ role: 'user', toolResults: [{ id: call.id, content: out, isError: false }] });
    ctx.barren = 0;
    log(`[engine]   text-extract: wrote ${path}`);
  }
  return true;
}

// Model wants to stop → run should_stop gates. Returns 'break' on accept,
// 'fallthrough' when a gate blocks (feedback injected, loop continues).
async function runStopGate(lr: LoopRun): Promise<'break' | 'fallthrough'> {
  const { ctx, runes, messages, log, opts, st } = lr;
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
    if (!st.exemplarShown && ctx.editedFiles.size > 0 && opts.onConsult) {
      st.exemplarShown = true;
      const ex = await opts.onConsult(ctx).catch(() => undefined);
      if (ex) {
        inject += `\n\nA passing test for a SIMILAR module (adapt its approach):\n${ex}`;
        log('[engine]   + similar exemplar injected');
      }
    }
    messages.push({ role: 'user', text: inject });
    return 'fallthrough';
  }
  st.accepted = true;
  st.stopReason = 'accepted';
  log('[engine]   ACCEPTED (all gates green)');
  return 'break';
}

// One turn: act → run tools, or (no tool calls) handle a text-extract write /
// run the stop gates. Returns 'break' to stop the loop (brain error or accept),
// 'fallthrough' to proceed to the escalation checks.
export async function runStep(lr: LoopRun): Promise<'break' | 'fallthrough'> {
  const { ctx, runes, messages, st, log } = lr;
  ctx.step++;
  for (const r of runes) await r.onTurnStart?.(ctx);
  const resp = await requestCompletion(lr);
  if (!resp) return 'break';
  st.tokensIn += resp.usage.input;
  st.tokensOut += resp.usage.output;
  st.cacheRead += resp.usage.cacheRead ?? 0;
  st.costUsd += resp.usage.costUsd ?? 0;
  log(
    `[engine] step ${ctx.step}: ${resp.toolCalls.length} tool call(s)${resp.text ? ' + text' : ''}` +
      `${resp.usage.cacheRead ? ` [cache hit ${resp.usage.cacheRead}]` : ''}`,
  );
  emit(lr, { tool: resp.toolCalls[0]?.name });
  messages.push({ role: 'assistant', text: resp.text || undefined, toolCalls: resp.toolCalls });
  const results = resp.toolCalls.length ? await applyToolCalls(lr, resp) : [];
  // One transcript write per turn, after results are known. st.brain.model is read
  // per turn → a takeover swap (engine-escalation swaps st.brain) is recorded on
  // the turns the stronger model drives. Covers tool turns, the final stop
  // paragraph, and text-extract prose (empty toolCalls → text-only turn).
  appendTranscript(lr, buildTurn({
    runId: lr.runId, step: ctx.step, model: st.brain.model,
    text: resp.text, toolCalls: resp.toolCalls, results, usage: resp.usage,
  }));
  if (resp.toolCalls.length > 0) return 'fallthrough';
  if (await tryTextExtract(lr, resp)) return 'fallthrough';
  return runStopGate(lr);
}
