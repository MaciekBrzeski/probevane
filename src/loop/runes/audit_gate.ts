import { join } from 'node:path';
import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { auditFiles, formatViolations } from '../../audit/core.js';

// audit_gate — qaforge's static quality gate promoted into a finish condition.
// The run cannot stop while any error-severity audit violation exists in the
// test files that were written/edited this run. Warnings don't block but lower
// the score (reported in the diary).
export const auditGate: Rune = {
  name: 'audit_gate',

  systemPromptAddition(): string {
    return [
      'QUALITY RULES (enforced by an audit gate): every test must make real',
      'assertions (no assertion-free or render-only tests); no .only; no',
      'waitForTimeout; API mutations in e2e must assert a status. If the audit',
      'gate reports a violation, fix it before finishing.',
    ].join(' ');
  },

  async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
    const rules = ctx.adapter.auditRules();
    if (rules.length === 0) return ALLOW;

    // Audit the spec files touched this run (fall back to all specs if none tracked).
    const allSpecs = await ctx.adapter.specFiles(ctx.workdir);
    const specSet = new Set(allSpecs.map((f) => f.replace(/^\.\//, '')));
    const tracked = [...ctx.editedFiles].filter((f) => specSet.has(f.replace(/^\.\//, '')));
    const targets = tracked.length ? tracked : allSpecs;
    const abs = targets.map((f) => join(ctx.workdir, f));

    const report = await auditFiles(abs, rules);
    if (report.errors > 0) {
      const errs = report.violations.filter((v) => v.severity === 'error');
      return block(
        `audit_gate: ${report.errors} quality violation(s)`,
        `The audit gate found quality problems. Fix these, then finish:\n${formatViolations(errs)}`,
      );
    }
    return ALLOW;
  },
};
