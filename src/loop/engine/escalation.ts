import { TOOL_SPECS } from '../tools.js';
import { isCircular, proposal as difficultyProposal } from '../difficulty.js';
import { stableCacheIndex, type LoopRun } from './phases.js';

// The stall-escalation ladder, ported 1:1 from runLoop's per-iteration tail. Each
// check returns true when it took over control flow — nudge/consult return true to
// `continue`, the stop checks return true to `break` (after setting st.stopReason).
// `started` = ctx.editedFiles.size > 0 (computed once per iteration by the caller).

// Read-thrash nudge: a run that keeps READING and never edits (the large-repo
// refactor stall — distinct read_file calls never look "circular", so the
// never-edited stop alone would let it churn to max_steps). Push it to commit
// EARLY — fired when it has burned non-edit turns OR a read budget — and
// ESCALATE once (a harder second nudge) before the never-edited stop, so an
// over-reading model (e.g. a capable cloud model) gets a firmer shove than one
// line. Reads/plans both grow `barren` until the first edit.
export function nudgeCheck(lr: LoopRun, started: boolean): boolean {
  const { ctx, messages, st, log } = lr;
  if (started || st.nudges >= 2 || !(ctx.barren >= lr.nudgeAfter || ctx.reads >= lr.readBudget)) return false;
  st.nudges++;
  const hard = st.nudges >= 2;
  messages.push({
    role: 'user',
    text: hard
      ? `STILL no edit after ${ctx.reads} reads. You have MORE than enough context. Do NOT call ` +
        `read_file or list_dir again — your very next action must be \`write_file\`/\`edit_file\` on ` +
        `the target (call \`plan\` first only if you haven't). If a path you wanted is outside the ` +
        `project you don't need it; implement from what you already import.`
      : `You've read ${ctx.reads} file(s) over ${ctx.step} turns without editing — you have enough ` +
        `context now. STOP reading. Call \`plan\` (if you haven't), then make your \`write_file\`/` +
        `\`edit_file\` change. The gates verify correctness — commit the edit; don't keep exploring.`,
  });
  log(`[engine] read-thrash nudge #${st.nudges}: ${ctx.barren} non-edit turns / ${ctx.reads} reads — pushing to plan+edit`);
  return true;
}

// Never-edited stall: a run with ZERO edits after forceStopAfter non-edit turns
// is stalled — a weak model emitting prose instead of write_file, OR a strong
// model over-reading a large repo (distinct reads never trip isCircular). Fire
// deterministically on barren-without-edit; don't also require circularity
// (that let big-repo refactors churn all the way to max_steps). Deterministic
// proposal only (the run must stay free / replayable).
export function neverEditedCheck(lr: LoopRun, started: boolean): boolean {
  const { ctx, st, log } = lr;
  if (started || ctx.barren < lr.forceStopAfter) return false;
  st.proposalText =
    `No test file produced in ${ctx.step} turns — the model isn't writing files ` +
    `(it may not support tool calls, or the target is too hard for it). ` +
    difficultyProposal(ctx);
  log(`[engine] difficulty (never-edited): stopping early — ${st.proposalText.split('—')[0].trim()}`);
  st.stopReason = 'difficulty';
  return true;
}

// Consult ladder: when stalled, escalate once before giving up. Pull extra
// guidance (e.g. a library exemplar via onConsult), nudge toward finish/cleanup,
// and — if a stronger brain is supplied — hand it the window (takeover).
//
// Two stall shapes trigger it:
//  - BARREN stall: `barren` non-edit turns (a model that stops editing / over-reads).
//  - GATE stall: a STARTED run that keeps EDITING but never converges — it passes
//    consultAtStep while still failing gates (gateBlocks>0). Its `barren` never
//    grows (every edit resets it), so the barren ladder alone never rescues it;
//    this is the edit-happy-thrash blind spot (e.g. a cloud model writing tests
//    with type errors it can't self-fix). Hand the window to the takeover brain.
export async function consultCheck(lr: LoopRun, started: boolean): Promise<boolean> {
  const { ctx, messages, st, opts, log } = lr;
  if (!started || st.consulted) return false;
  const barrenStall = ctx.barren >= lr.consultAfter;
  const gateStall = ctx.step >= lr.consultAtStep && ctx.gateBlocks > 0;
  if (!barrenStall && !gateStall) return false;
  st.consulted = true;
  ctx.barren = 0;
  let msg = barrenStall
    ? `You have made ${lr.consultAfter} turns with no productive change. Re-read the latest gate ` +
      `feedback above. If you believe the tests are complete, STOP CALLING TOOLS so the gates can ` +
      `run. If a test file is empty or a leftover, delete_file it. Do not keep reading.`
    : `You have edited for ${ctx.step} turns but the gates are still failing (${ctx.gateBlocks} blocks). ` +
      `Stop churning: re-read the latest gate feedback above and fix the ROOT cause decisively ` +
      `(e.g. resolve the reported type errors), then STOP CALLING TOOLS so the gates can run.`;
  // Skip the exemplar here if already surfaced on the first block (no blanket
  // re-injection — fourier: blanket retrieval is noise).
  if (!st.exemplarShown) {
    const extra = await opts.onConsult?.(ctx).catch(() => undefined);
    if (extra) { msg += `\n\nHELP:\n${extra}`; st.exemplarShown = true; }
  }
  if (opts.takeoverBrain) {
    st.brain = opts.takeoverBrain;
    st.tookOver = true;
    msg += `\n\n(A stronger model is now assisting; resolve the gate failures decisively.)`;
    log(`[engine] consult: TAKEOVER by ${st.brain.model}`);
  } else {
    log('[engine] consult: injecting extra guidance');
  }
  messages.push({ role: 'user', text: msg });
  return true;
}

// Difficulty gate: once we've already escalated (consulted/took over) and the
// loop is still CIRCLING — same gate-block reason or identical tool call ≥3× —
// stop early and PROPOSE a way forward instead of burning the rest of the
// budget churning. Deterministic proposal first; one LLM proposal turn appended
// when there's budget headroom (skipped in deterministic/replay mode).
export async function difficultyCheck(lr: LoopRun, started: boolean): Promise<boolean> {
  const { ctx, messages, st, opts, system, log } = lr;
  if (!started || !st.consulted || !isCircular(ctx)) return false;
  st.proposalText = difficultyProposal(ctx);
  const outOfBudget = opts.budget ? st.tokensOut >= opts.budget : false;
  if (!outOfBudget && process.env.PROBEVANE_DETERMINISTIC !== '1') {
    try {
      messages.push({
        role: 'user',
        text:
          `${st.proposalText}\n\nYou appear stuck. In <=5 lines, propose a simpler target or ` +
          `explain the exact blocker. Do NOT call tools.`,
      });
      const r = await st.brain.complete({
        system, messages, tools: TOOL_SPECS, cachePrefixIndex: stableCacheIndex(messages.length),
      });
      st.tokensIn += r.usage.input;
      st.tokensOut += r.usage.output;
      st.cacheRead += r.usage.cacheRead ?? 0;
      st.costUsd += r.usage.costUsd ?? 0;
      if (r.text.trim()) st.proposalText += `\n\nModel: ${r.text.trim()}`;
    } catch { /* deterministic proposal still stands */ }
  }
  log(`[engine] difficulty: stopping + proposing — ${st.proposalText.split('\n')[0]}`);
  st.stopReason = 'difficulty';
  return true;
}

export function stuckCheck(lr: LoopRun, started: boolean): boolean {
  const { ctx, st, log } = lr;
  if (!started || ctx.barren < lr.forceStopAfter) return false;
  log(`[engine] giving up: ${ctx.barren} barren turns (forceStopAfter=${lr.forceStopAfter})`);
  st.stopReason = 'stuck';
  return true;
}

// Hard cost ceiling — never let a stuck loop drain the budget.
export function budgetCheck(lr: LoopRun): boolean {
  const { st, log, opts } = lr;
  if (!opts.budget || st.tokensOut < opts.budget) return false;
  log(`[engine] budget reached: ${st.tokensOut} >= ${opts.budget} output tokens`);
  st.stopReason = 'budget';
  return true;
}
