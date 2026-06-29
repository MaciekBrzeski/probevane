import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { RunScope } from '../../adapters/adapter.js';
import { sh } from '../../util/exec.js';
import { newSpecs } from './validation_gate.js';

// acceptance_gate — ported from runestone acceptance_gate.rs. The run can't
// finish until the user-specified acceptance criteria pass: a minimum test
// count, a minimum coverage threshold, and any raw shell checks (exit 0). This
// is where "the deliverable is actually covered" is enforced — the recurring
// runestone lesson: acceptance must cover the visible deliverable.
export interface AcceptanceOpts {
  scope: RunScope;
  minTests?: number;
  minCoverage?: number; // percent statements
  shellChecks?: string[];
}

function acceptanceSystemPrompt(opts: AcceptanceOpts): string {
  const parts: string[] = [];
  if (opts.minTests) parts.push(`at least ${opts.minTests} passing tests`);
  if (opts.minCoverage) parts.push(`statement coverage ≥ ${opts.minCoverage}%`);
  if (!parts.length) return '';
  return `ACCEPTANCE: the run is not done until there are ${parts.join(' and ')}.`;
}

async function checkMinTests(ctx: RunCtx, opts: AcceptanceOpts): Promise<RuneDecision | undefined> {
  if (opts.minTests === undefined) return undefined;
  const ours = newSpecs(ctx);
  const run = await ctx.adapter.run(ctx.workdir, opts.scope, ours.length ? ours : undefined);
  ctx.lastRunPassed = run.passed; // captured so the factory needn't re-run the suite
  if (run.passed < opts.minTests) {
    return block(
      `acceptance_gate: only ${run.passed} passing tests (need ${opts.minTests})`,
      `You have ${run.passed} passing ${opts.scope} tests but acceptance requires at least ${opts.minTests}. Add more meaningful tests.`,
    );
  }
  return undefined;
}

async function checkMinCoverage(ctx: RunCtx, opts: AcceptanceOpts): Promise<RuneDecision | undefined> {
  if (opts.minCoverage === undefined) return undefined;
  const cov = await ctx.adapter.coverage(ctx.workdir);
  ctx.lastCoverage = cov.statements;
  if (!cov.ok) {
    return block('acceptance_gate: coverage unavailable', 'Coverage could not be measured; ensure the suite runs under coverage.');
  }
  if (cov.statements < opts.minCoverage) {
    return block(
      `acceptance_gate: coverage ${cov.statements}% < ${opts.minCoverage}%`,
      `Statement coverage is ${cov.statements}% but acceptance requires ≥ ${opts.minCoverage}%. Cover the untested branches/functions.`,
    );
  }
  return undefined;
}

async function checkShellChecks(ctx: RunCtx, opts: AcceptanceOpts): Promise<RuneDecision | undefined> {
  for (const cmd of opts.shellChecks ?? []) {
    const r = await sh(cmd, ctx.workdir);
    if (!r.ok) {
      return block(
        `acceptance_gate: check failed \`${cmd}\``,
        `The acceptance check \`${cmd}\` failed:\n${(r.stdout + r.stderr).slice(-1500)}`,
      );
    }
  }
  return undefined;
}

async function acceptanceShouldStop(ctx: RunCtx, opts: AcceptanceOpts): Promise<RuneDecision> {
  return (
    (await checkMinTests(ctx, opts)) ??
    (await checkMinCoverage(ctx, opts)) ??
    (await checkShellChecks(ctx, opts)) ??
    ALLOW
  );
}

export function acceptanceGate(opts: AcceptanceOpts): Rune {
  return {
    name: 'acceptance_gate',
    systemPromptAddition: () => acceptanceSystemPrompt(opts),
    shouldStop: (ctx) => acceptanceShouldStop(ctx, opts),
  };
}
