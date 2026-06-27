import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { scanMfe } from '../../mfe/scan.js';
import { formatMfe } from '../../mfe/standards.js';

// mfe_gate (opt-in) — a finish condition that holds a Module-Federation repo to its
// architectural standards (boundaries, shared singletons, runtime resilience, typed
// contracts; see src/mfe/standards.ts). BASELINE-AWARE: it snapshots the repo's
// error count at run start (prepare) and blocks only when the run INCREASED it —
// so fixing a pre-existing MFE app isn't punished, only making it worse is. No-op
// on a repo without a federation config. Opt in on source-editing profiles.
export function mfeGate(designSystem?: string): Rune {
  let baseline = -1; // -1 = not an MFE repo (gate disabled); else error count at start

  return {
    name: 'mfe_gate',

    systemPromptAddition(): string {
      return [
        'MICRO-FRONTEND STANDARDS (Module Federation, enforced by a gate): no deep',
        "imports past a remote's exposed API; framework deps shared as singletons;",
        'host remote-mounts wrapped in Suspense + an error boundary; exposed modules',
        "typed (.ts/.tsx). Don't regress these in the files you edit.",
      ].join(' ');
    },

    // Snapshot the baseline BEFORE any edit (prepare runs once, pre-loop).
    async prepare(ctx: RunCtx): Promise<string | undefined> {
      const scan = await scanMfe(ctx.workdir, designSystem).catch(() => null);
      baseline = scan ? scan.audit.errors : -1;
      return undefined;
    },

    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      if (baseline < 0) return ALLOW; // not a federation repo
      const scan = await scanMfe(ctx.workdir, designSystem).catch(() => null);
      if (!scan) return ALLOW;
      if (scan.audit.errors <= baseline) return ALLOW; // no regression (or an improvement)
      const errs = scan.audit.violations.filter((v) => v.severity === 'error');
      return block(
        `mfe_gate: MFE standards regressed (${scan.audit.errors} error(s), was ${baseline})`,
        `FIX THIS FIRST — your edits broke a Module Federation standard:\n${formatMfe(errs)}\n\n` +
          `Get back to (or below) the starting error count. Pre-existing issues you didn't worsen are fine.`,
      );
    },
  };
}
