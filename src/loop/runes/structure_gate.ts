import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { buildGraph } from '../../mock/graph.js';
import { pyramidReport, type PyramidViolation } from '../../commands/arch/pyramid.js';
import { loadConfig } from '../../util/config.js';

// structure_gate (opt-in) — the pyramid structure model (arch --pyramid) as a
// finish condition. Ratchet-style: it snapshots the repo's pyramid violations
// at run start, and blocks finishing only if the run INTRODUCED a new one — so
// working in an already-imperfect tree isn't punished, but adding a
// cross-feature import, a base→tip dependency, or a glue-reaches-past-the-base
// edge is. Roles come from the TARGET repo's probevane.config, same as the CLI;
// the pre-run snapshot is the baseline (no baseline file). See ADR-020.

/** Stable identity of one violation — a run "introduced" it if this key is new. */
function vKey(v: PyramidViolation): string {
  return `${v.kind}|${v.from}|${v.to}`;
}

interface StructureState {
  baseline: Set<string>; // violation keys present before the run edited anything
}

const STRUCTURE_SYSTEM_PROMPT =
  'STRUCTURE (enforced by a pyramid-model gate): do NOT introduce a new cross-directory ' +
  'dependency that breaks the layering — no feature→feature import (route through glue or ' +
  'promote the shared piece), no shared→feature or feature→glue inversion, no reaching into a ' +
  "feature's subfolders from glue. Keep each top-level dir's imports pointing where they already do.";

/** Snapshot the repo's current pyramid violations before any edit. */
async function structurePrepare(ctx: RunCtx, state: StructureState): Promise<string | undefined> {
  const roles = (await loadConfig(ctx.workdir)).arch ?? {};
  const graph = await buildGraph(ctx.workdir);
  const report = pyramidReport(graph, roles);
  state.baseline = new Set(report.violations.map(vKey));
  return state.baseline.size
    ? `Structure baseline: ${state.baseline.size} pre-existing pyramid violation(s) tolerated; do not add more.`
    : 'Structure baseline: the tree fits the pyramid model — keep it that way.';
}

/** Block with the first newly-introduced violation, named + with its fix. */
function blockNew(added: PyramidViolation[]): RuneDecision {
  const v = added[0];
  const examples = v.examples.slice(0, 2).join('\n  ');
  return block(
    `structure_gate: ${added.length} new pyramid violation(s) introduced`,
    `FIX THIS FIRST — new [${v.kind}] ${v.from} → ${v.to} (${v.count} import(s)):\n  ${examples}\n\n` +
      `${v.fix}. Pre-existing structural issues you didn't add to are fine.`,
  );
}

/** Recompute violations; allow unless a key absent at run start is now present. */
async function structureShouldStop(ctx: RunCtx, state: StructureState): Promise<RuneDecision> {
  const roles = (await loadConfig(ctx.workdir)).arch ?? {};
  const report = pyramidReport(await buildGraph(ctx.workdir), roles);
  const added = report.violations.filter((v) => !state.baseline.has(vKey(v)));
  return added.length ? blockNew(added) : ALLOW;
}

/** Build the structure gate; per-instance state holds the pre-run violation snapshot. */
export function structureGate(): Rune {
  const state: StructureState = { baseline: new Set() };
  return {
    name: 'structure_gate',
    systemPromptAddition: () => STRUCTURE_SYSTEM_PROMPT,
    prepare: (ctx) => structurePrepare(ctx, state),
    shouldStop: (ctx) => structureShouldStop(ctx, state),
  };
}
