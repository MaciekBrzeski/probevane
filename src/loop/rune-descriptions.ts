import type { Rune } from './rune.js';

// Human-readable descriptions for each loop Rune + each loop hook. This is the
// curated copy shown in the wiki pipeline configurator's click-to-explain drawer
// ("what does this part do"). The drift-free, self-explaining part — the LITERAL
// rule a rune injects into the model — is NOT duplicated here: describeRune()
// reads it live from the rune's own systemPromptAddition(). Curated text covers
// the "why" and the runes that inject nothing (pure event/harvest runes).

export interface RuneDescription {
  /** One-line "what it is". */
  summary: string;
  /** A short paragraph: what it does + why it exists. */
  detail: string;
}

/** Curated copy per rune name. Keep one entry for every rune any profile uses. */
export const RUNE_DESCRIPTIONS: Record<string, RuneDescription> = {
  context_inject: {
    summary: 'Seeds the prompt with project context.',
    detail:
      'Before the run it appends ground-truth context — learned few-shot exemplars from the cross-project library and target-specific patterns — so the model writes to the real API instead of guessing.',
  },
  mock_inject: {
    summary: 'Injects synthesized mocks into context.',
    detail:
      'Tells the model which network calls have generated MSW handlers / vi.mock fixtures available, so tests stay hermetic and use the mock maker output instead of a live backend.',
  },
  path_guard: {
    summary: 'Keeps edits inside the source tree.',
    detail:
      'A per-turn guard that vetoes any write outside project source (node_modules, build output, lockfiles, tooling). Prevents a stuck model from "fixing" its toolchain — e.g. overwriting node_modules/.bin/tsc.',
  },
  plan_first: {
    summary: 'Forces a plan before any edit.',
    detail:
      'Blocks write_file/edit_file until the model has called the plan tool exactly once, naming targets, behaviors, and concrete assertions. Stops the model from coding before it has read and thought.',
  },
  red_first: {
    summary: 'TDD: a failing test must come first.',
    detail:
      'For the feature path. Vetoes editing any source file until a NEW test exists and FAILS against the current code, then requires the implementation to make it pass without weakening the test — real red→green.',
  },
  no_regression: {
    summary: 'Protects the existing test suite.',
    detail:
      'Forbids modifying or deleting any pre-existing test file; only new test files may be added. Guarantees the run cannot "pass" by quietly weakening the contract that already protects the code.',
  },
  behavior_lock: {
    summary: 'Characterization lock: tests are the contract.',
    detail:
      'For refactor/migrate/document. Snapshots the green suite and blocks test edits so only source changes — the unchanged tests then prove behavior was preserved across the change.',
  },
  validation_gate: {
    summary: 'Finish gate: typecheck clean + new tests green.',
    detail:
      'On a stop attempt, runs the scoped tests and a typecheck. Blocks finishing unless the change adds no new type errors and the new tests run green (not all-skipped) — reporting the first failure to fix.',
  },
  audit_gate: {
    summary: 'Finish gate: test-quality rules.',
    detail:
      'Static-audits the written specs for anti-patterns — assertion-free / render-only tests, .only, waitForTimeout, unasserted API mutations — and blocks until they are clean, so green tests are also meaningful.',
  },
  hermetic_gate: {
    summary: 'Finish gate: no real network/clock/random.',
    detail:
      'Scans the specs this run wrote and rejects any that hit a live URL or use Date.now()/Math.random() unmocked — tests must route through mocks and control time/seed, so they are deterministic and not flaky.',
  },
  acceptance_gate: {
    summary: 'Finish gate: enough tests / coverage.',
    detail:
      'The run is not done until the acceptance bar is met — a minimum number of passing tests (and optionally coverage and shell checks). Stops the loop from accepting a token-effort result.',
  },
  oracle_gate: {
    summary: 'Finish gate: typed acceptance oracles hold.',
    detail:
      "Self-configuring from the target's probevane.config `oracles` block (ADR-022). Golden/byte-stable oracles lock a producer's output on first green and byte-verify it after (drift blocks); invariant/property oracles run a blocking assertion command. No-op when no oracles are declared.",
  },
  flake_gate: {
    summary: 'Finish gate: new specs are stable.',
    detail:
      'Opt-in. Runs the new specs several times and rejects nondeterminism (a spec that passes then fails), allowing only a configured tolerance — catches order- or timing-dependent flake before it lands.',
  },
  assertion_gate: {
    summary: 'Finish gate: assertion-quality floor.',
    detail:
      'Opt-in. Scores the assertion strength of the new tests and feeds a floor back into the loop, pushing the model past shallow truthiness checks toward concrete value assertions.',
  },
  mutation_gate: {
    summary: 'Finish gate: tests catch real mutations.',
    detail:
      'Opt-in (slow). Mutates the source and checks the new tests fail on the mutants — proves the suite actually detects regressions instead of just executing code for coverage.',
  },
  a11y_gate: {
    summary: 'Finish gate: accessibility assertions.',
    detail:
      'Opt-in. Requires component/e2e specs to assert accessibility (roles, labels, or an axe check) so generated UI tests cover a11y rather than only happy-path rendering.',
  },
  visual_gate: {
    summary: 'Finish gate: e2e visual checkpoint.',
    detail:
      'Opt-in, e2e only. Requires e2e specs to capture a screenshot checkpoint, adding a visual-regression anchor to the generated end-to-end coverage.',
  },
  quality_gate: {
    summary: 'Finish gate: edited source must not regress.',
    detail:
      'Opt-in. Runs a source-quality analysis on the files the model edited and blocks if quality regresses (e.g. oversized files/functions), keeping the change clean, not just green.',
  },
  structure_gate: {
    summary: 'Finish gate: no new pyramid-structure violations.',
    detail:
      'Opt-in. Snapshots the repo\'s pyramid-model violations at run start and blocks finishing if the run introduced a new cross-directory layering violation (feature\u2192feature, base\u2192tip, glue reaching past a feature base). Pre-existing issues are tolerated \u2014 ratchet, not absolute.',
  },
  mfe_gate: {
    summary: 'Finish gate: micro-frontend standards.',
    detail:
      'Opt-in. Enforces Module Federation conventions on a micro-frontend project; a no-op off-federation, so it is safe to leave enabled.',
  },
  session_diary: {
    summary: 'Records a run summary on stop.',
    detail:
      'A harvest rune (no rule injected): on termination it writes a short diary entry of what the run did and how it ended, feeding the cross-session history.',
  },
  caveat_harvest: {
    summary: 'Captures gotchas for next time.',
    detail:
      'A harvest rune: on stop it extracts caveats hit during the run (gate blocks, dead ends) into the learning library so future runs are pre-warned.',
  },
  distill_trace: {
    summary: 'Saves an accepted run as a training trace.',
    detail:
      'A harvest rune, opt-in via PROBEVANE_TRACES=1: on an accepted run it records the task + accepted spec as a distillation trace for later local-model fine-tuning.',
  },
  library_promote: {
    summary: 'Promotes good specs to the library.',
    detail:
      'A harvest rune: on acceptance it promotes the strongest new specs into the cross-project learning library so they can seed future generations as few-shot exemplars.',
  },
};

/** What each loop hook does (the lifecycle point a rune plugs into). */
export const HOOK_DESCRIPTIONS: Record<string, string> = {
  systemPromptAddition: 'Appends static rule text to the system prompt.',
  prepare: 'Async pre-run contribution (e.g. RAG few-shot) appended before the first turn.',
  onTurnStart: 'Runs at the start of every turn.',
  beforeToolCall: 'Vetoes a tool before it runs — the first rune to block wins.',
  afterToolCall: 'Observes a completed tool call (tracks state).',
  shouldStop: "Gates the model's intent to finish — a block injects feedback and the loop continues.",
  onStop: 'Runs once on termination (record / learn / harvest).',
};

/** A rune description resolved with its live injected rule (if any). */
export interface ResolvedRuneDescription extends RuneDescription {
  name: string;
  /** The literal text this rune injects into the system prompt, read live. */
  rule?: string;
}

/**
 * Merge the curated description for `name` with the rune's OWN injected rule,
 * read live from systemPromptAddition() so it never drifts from behavior. The
 * call is guarded: some runes fill the rule from run context and throw without
 * it — those simply have no `rule`. Pure event runes inject nothing → no rule.
 */
export function describeRune(name: string, rune?: Rune): ResolvedRuneDescription {
  const base = RUNE_DESCRIPTIONS[name] ?? { summary: name, detail: '' };
  let rule: string | undefined;
  try {
    const r = rune?.systemPromptAddition?.();
    if (typeof r === 'string' && r.trim().length > 0) rule = r;
  } catch {
    /* needs run context — omit the live rule */
  }
  return { name, summary: base.summary, detail: base.detail, rule };
}
