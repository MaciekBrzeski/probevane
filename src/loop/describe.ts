import { profileSegments, type ProfileName, type ProfileOpts, type SubroutineId } from './profiles.js';
import type { Rune } from './rune.js';
import { describeRune, HOOK_DESCRIPTIONS } from './rune-descriptions.js';

// Pure description of an assembled loop pipeline — no run required. `profile()` is a pure
// (config) -> Rune[] function, so we can introspect each rune's hooks to bucket it into a
// loop phase and emit a serializable model / Mermaid graph. Used by `probevane pipeline`
// and the wiki "Loop pipeline" interactive demo.

const HOOKS = [
  'systemPromptAddition', 'prepare', 'onTurnStart',
  'beforeToolCall', 'afterToolCall', 'shouldStop', 'onStop',
] as const;
type Hook = (typeof HOOKS)[number];

export type Phase = 'context' | 'guard' | 'observer' | 'gate' | 'harvest';
export const PHASES: { id: Phase; label: string; detail: string }[] = [
  { id: 'context', label: 'Context / prepare', detail: 'Before the run: prepare()/systemPromptAddition runes seed the model with project context, rules, and few-shot exemplars.' },
  { id: 'guard', label: 'Per-turn guards (beforeToolCall — first block wins)', detail: 'On every tool call, beforeToolCall runes can veto it before it runs. The first rune to block wins, so order matters.' },
  { id: 'observer', label: 'Observers (afterToolCall)', detail:
    'After a tool completes, afterToolCall runes observe the result to track state — they do not block.' },
  { id: 'gate', label: 'Finish gates (shouldStop — first block injects + continues)', detail: "When the model tries to finish, shouldStop runes gate it. A block injects feedback and the loop continues; acceptance needs every gate green." },
  { id: 'harvest', label: 'Harvest (onStop)', detail:
    'On termination, onStop runes record and learn — diaries, caveats, traces, library promotion.' },
];

/** Subroutines — the reused pipeline segments a profile composes from (ordered). */
export const SUBROUTINES: { id: SubroutineId; label: string; detail: string }[] = [
  { id: 'preamble', label: 'Preamble (context + guards + plan)', detail: 'Shared setup every working profile starts with: inject context, guard the write scope, and require a plan — plus optional TDD red-gate / regression guard.' },
  { id: 'green-gates', label: 'Green-suite gates (validation → audit → hermetic → acceptance)', detail: 'The finish-gate stack that proves the change is real: typecheck + tests green, audit-clean, hermetic, and meets the acceptance bar.' },
  { id: 'safety-net', label: 'Safety net (behavior lock)', detail: 'The characterization-first alternative to green-gates for source-changing profiles: lock the tests so only source changes and behavior is provably preserved.' },
  { id: 'opt-in', label: 'Opt-in gates (quality / mfe / extras)', detail: 'Toggle-enabled extra gates — source quality, micro-frontend standards, and the write_tests extras (flake / assertion / mutation / a11y / visual).' },
  { id: 'harvest', label: 'Harvest (diary / caveats / distil)', detail: 'The on-stop tail that turns each run into learning: session diary, caveat capture, and (full) distil trace + library promotion.' },
];

/** Toggle knobs that ADD runes (ProfileOpts fields). UI label -> the ProfileOpts key. */
export const TOGGLES: { key: keyof ProfileOpts; label: string; detail: string }[] = [
  { key: 'quality', label: 'quality', detail: 'Adds quality_gate — blocks finishing if the source you edited regresses in quality (oversized files/functions, etc.).' },
  { key: 'mutation', label: 'mutation', detail: 'Adds mutation_gate — mutates the source and requires the new tests to catch the mutants (slow, strongest signal).' },
  { key: 'flakeGuard', label: 'flake', detail:
    'Adds flake_gate — runs the new specs several times and rejects nondeterminism.' },
  { key: 'assertMin', label: 'assertion', detail:
    'Adds assertion_gate — enforces an assertion-quality floor on the new tests.' },
  { key: 'a11y', label: 'a11y', detail:
    'Adds a11y_gate — requires component/e2e specs to assert accessibility (roles / labels / axe).' },
  { key: 'visual', label: 'visual', detail:
    'Adds visual_gate (e2e only) — requires e2e specs to capture a screenshot checkpoint.' },
  { key: 'mfe', label: 'mfe', detail:
    'Adds mfe_gate — enforces Module Federation standards on a micro-frontend project (no-op off-federation).' },
];

export interface RuneInfo {
  name: string;
  hooks: Hook[];
  /** Primary loop phase for layout: a tool-vetoing rune is a guard even if it also gates. */
  phase: Phase;
  /** Which reused subroutine segment this rune came from (for the subroutine view). */
  subroutine: SubroutineId;
  /** Human-readable one-liner (curated). */
  summary: string;
  /** Human-readable paragraph: what it does + why (curated). */
  detail: string;
  /** The literal rule this rune injects into the model, read live from systemPromptAddition(). */
  rule?: string;
}

function hooksOf(r: Rune): Hook[] {
  return HOOKS.filter((h) => typeof (r as unknown as Record<string, unknown>)[h] === 'function');
}

function phaseOf(hooks: Hook[]): Phase {
  if (hooks.includes('beforeToolCall')) return 'guard';
  if (hooks.includes('shouldStop')) return 'gate';
  if (hooks.includes('afterToolCall')) return 'observer';
  if (hooks.includes('onStop')) return 'harvest';
  return 'context';
}

/** The ordered runes of a profile+options, each with its hooks + primary phase + subroutine. */
export function describePipeline(name: ProfileName, opts: ProfileOpts): { profile: ProfileName; runes: RuneInfo[] } {
  const runes = profileSegments(name, opts).flatMap((seg) =>
    seg.runes.map((r): RuneInfo => {
      const hooks = hooksOf(r);
      const d = describeRune(r.name, r);
      return {
        name: r.name,
        hooks,
        phase: phaseOf(hooks),
        subroutine: seg.sub,
        summary: d.summary,
        detail: d.detail,
        rule: d.rule,
      };
    }),
  );
  return { profile: name, runes };
}

/** A toggle-aware, drift-free model: the full pipeline with each rune labelled by which
 *  toggle (if any) enables it — derived by diffing real `profile()` calls. */
export interface ModelRune extends RuneInfo {
  requiredBy: string | null; // null = always; else the TOGGLES label that adds it
  e2eOnly: boolean;          // visual gate only applies to e2e
}
export type PipelineModel = Record<string, ModelRune[]>;

const ALL_ON: ProfileOpts = {
  kind: 'e2e', quality: true, mutation: true, flakeGuard: true,
  assertMin: 80, a11y: true, visual: true, mfe: true,
};

function optsForToggle(key: keyof ProfileOpts): ProfileOpts {
  const o: ProfileOpts = { kind: 'e2e' };
  (o as unknown as Record<string, unknown>)[key] = key === 'assertMin' ? 80 : true;
  return o;
}

export function pipelineModel(name: ProfileName): ModelRune[] {
  const full = describePipeline(name, ALL_ON).runes;
  const baseNames = new Set(describePipeline(name, { kind: 'e2e' }).runes.map((r) => r.name));
  // Which toggle (alone) introduces each non-base rune.
  const toggleAdds = new Map<string, string>();
  for (const t of TOGGLES) {
    for (const r of describePipeline(name, optsForToggle(t.key)).runes) {
      if (!baseNames.has(r.name) && !toggleAdds.has(r.name)) toggleAdds.set(r.name, t.label);
    }
  }
  return full.map((r) => ({
    ...r,
    requiredBy: baseNames.has(r.name) ? null : (toggleAdds.get(r.name) ?? null),
    e2eOnly: r.name === 'visual_gate',
  }));
}

/** The whole-model (all profiles) for the wiki demo client. */
export function fullModel(): {
  profiles: PipelineModel;
  toggles: typeof TOGGLES;
  phases: typeof PHASES;
  subroutines: typeof SUBROUTINES;
  hookDescriptions: typeof HOOK_DESCRIPTIONS;
} {
  const names: ProfileName[] = ['write_tests', 'feature', 'refactor', 'repair', 'fix', 'migrate', 'document', 'bare'];
  const profiles: PipelineModel = {};
  for (const n of names) profiles[n] = pipelineModel(n);
  return { profiles, toggles: TOGGLES, phases: PHASES, subroutines: SUBROUTINES, hookDescriptions: HOOK_DESCRIPTIONS };
}

function nodeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** A phase-grouped Mermaid flowchart of the given runes (for the CLI + static fallback). */
export function pipelineMermaid(runes: RuneInfo[]): string {
  const byPhase = new Map<Phase, RuneInfo[]>();
  for (const r of runes) (byPhase.get(r.phase) ?? byPhase.set(r.phase, []).get(r.phase)!).push(r);
  const lines: string[] = ['flowchart TD'];
  const phaseAnchors: string[] = [];
  for (const { id, label } of PHASES) {
    const rs = byPhase.get(id);
    if (!rs || !rs.length) continue;
    lines.push(`  subgraph ${id}["${label}"]`);
    lines.push('    direction TB');
    let prev = '';
    for (const r of rs) {
      const nid = nodeId(r.name);
      lines.push(`    ${nid}["${r.name}"]${id === 'gate' ? ':::gate' : id === 'guard' ? ':::guard' : ''}`);
      if (prev) lines.push(`    ${prev} --> ${nid}`);
      prev = nid;
    }
    phaseAnchors.push(nodeId(rs[0]!.name));
  }
  // Phase-to-phase flow + a "continue" loop back from gates to guards.
  for (let i = 0; i + 1 < phaseAnchors.length; i++) lines.push(`  ${phaseAnchors[i]} --> ${phaseAnchors[i + 1]}`);
  lines.push('  classDef gate fill:#3a2233,stroke:#d29922,color:#eee;');
  lines.push('  classDef guard fill:#1f2a3a,stroke:#58a6ff,color:#eee;');
  return ['```mermaid', lines.join('\n'), '```'].join('\n');
}
