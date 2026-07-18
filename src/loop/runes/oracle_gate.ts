import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { loadConfig, type OracleSpec, type ProbevaneConfig } from '../../util/config.js';
import { runGoldenOracle, captureOracle, goldenKey } from '../oracle-lock.js';

// oracle_gate — enforces the typed acceptance oracles (ADR-022 Phase 1) declared
// in the target's probevane.config `oracles` block. Self-configuring: reads the
// config at stop-intent, so it's safe to include in every pipeline (no oracles →
// ALLOW). Only oracles with a `producer` are ENFORCED (declared-only oracles are
// advisory, surfaced by context_inject + the `spec` report):
//   golden / byte-stable → the producer's stdout is locked on first green
//     (.probevane/oracles/<key>.json) and byte-verified after; drift blocks.
//   invariant / property  → the producer is a blocking assertion command (exit 0).
// The golden-lock mirrors the mutation ratchet: capture → commit → verify.

/** Enforce one oracle; returns a Block on failure/drift, undefined on pass. */
async function checkOracle(ctx: RunCtx, key: string, o: OracleSpec): Promise<RuneDecision | undefined> {
  if (!o.producer) return undefined; // declared-only — not enforced without a producer
  if (o.kind === 'golden' || o.kind === 'byte-stable') {
    const r = await runGoldenOracle(ctx.workdir, key, o.producer);
    if (r.status === 'producer-failed')
      return block(`oracle_gate: ${key} producer failed`, `${o.desc}\n\n${r.detail}`);
    if (r.status === 'mismatch')
      return block(
        `oracle_gate: ${key} golden drifted`,
        `${o.desc}\n\n${r.detail}\n\nIf this change is intentional, delete .probevane/oracles/${goldenKey(key)}.json to re-lock; otherwise the behavior regressed.`,
      );
    return undefined; // locked (first green) or match
  }
  // invariant / property: the producer is a blocking assertion — exit 0 required.
  const cap = await captureOracle(ctx.workdir, o.producer);
  if (!cap.ok) return block(`oracle_gate: ${key} ${o.kind} oracle failed`, `${o.desc}\n\n${cap.err}`);
  return undefined;
}

/** Run every declared oracle in order; the first failure blocks. */
async function oracleShouldStop(ctx: RunCtx): Promise<RuneDecision> {
  const cfg = await loadConfig(ctx.workdir).catch((): ProbevaneConfig => ({}));
  const oracles = cfg.oracles ?? {};
  for (const [key, o] of Object.entries(oracles)) {
    const decision = await checkOracle(ctx, key, o);
    if (decision) return decision;
  }
  return ALLOW;
}

/** The oracle-enforcement rune (ADR-022 Phase 1). */
export function oracleGate(): Rune {
  return {
    name: 'oracle_gate',
    shouldStop: (ctx) => oracleShouldStop(ctx),
  };
}
