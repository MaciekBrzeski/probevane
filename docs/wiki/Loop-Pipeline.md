# Loop pipeline

probevane's loop is assembled from modular **Runes** — small gate/harness plugins hooked
into fixed points of the loop. The set + order is a **pure function of the config**
(`profile(name, opts)` in `src/loop/profiles.ts`), so a chosen configuration's pipeline is
fully derivable without running anything.

→ **[Loop pipeline (demo)](/demo/pipeline)** — an interactive configurator: pick a profile,
toggle gates, set params, and see the runes it assembles as a phase-grouped graph. Paste a
`probevane.config.json` to see how *that* config looks. **Click any node, group header, or a
gate toggle's ⓘ** for a plain-English explanation — a rune's panel also shows the *literal rule
it injects into the model* (read live from its `systemPromptAddition`, so it can't drift).

## Loop phases (a rune's hooks place it here)

1. **Context / prepare** — `prepare` / `systemPromptAddition`: RAG, few-shot, rules text
   (e.g. `context_inject`, `mock_inject`).
2. **Per-turn guards** — `beforeToolCall`: veto a tool before it runs; first block wins
   (`path_guard`, `plan_first`, `no_regression`, `red_first`, `behavior_lock`).
3. **Observers** — `afterToolCall`: watch a completed tool (track state).
4. **Finish gates** — `shouldStop`: gate the model's intent to finish; first block injects
   feedback and the loop continues (`validation_gate`, `audit_gate`, `hermetic_gate`,
   `acceptance_gate`, and opt-ins `flake_gate`, `mutation_gate`, `a11y_gate`, `visual_gate`,
   `assertion_gate`, `quality_gate`, `mfe_gate`).
5. **Harvest** — `onStop`: record/learn on termination (`session_diary`, `caveat_harvest`,
   `distill_trace`, `library_promote`).

## Subroutines (reused segments)

Profiles aren't bespoke — they **compose from a few proven subroutines**
(`profileSegments()` in `src/loop/profiles.ts` is the single source of truth;
`profile()` is just that flattened). Each subroutine is a contiguous segment:

1. **preamble** — `context_inject` + `path_guard` + `plan_first`, plus the optional
   `red_first` (TDD) and `no_regression` guards.
2. **green-gates** — `validation_gate` → `audit_gate` → `hermetic_gate`, plus an optional
   `acceptance_gate` (test-count / coverage / shell checks).
3. **safety-net** — `behavior_lock`: the characterization-first alternative to green-gates
   for source-changing profiles (refactor / migrate / document).
4. **opt-in** — the toggle gates (quality / mfe, plus write_tests' extras suite of
   flake / assertion / mutation / a11y / visual).
5. **harvest** — `session_diary` + `caveat_harvest`, plus `distill_trace` + `library_promote`
   on the "full" tail.

Because of this, **`repair` ≡ `fix`** and **`refactor` ≡ `migrate`** share the exact same
composition. Switch the demo's **Group by** knob to *subroutine* to see profiles as these
reused blocks instead of by loop phase.

## Profiles

`write_tests` · `feature` (TDD red-first) · `refactor` · `repair` · `fix` · `migrate` ·
`document` · `bare`. Gate toggles (quality / mutation / flake / assertion / a11y / visual /
mfe) add runes; numeric/model knobs (maxSteps / minTests / minCoverage / budget / model)
tune parameters but don't change which runes run.

## CLI

`probevane pipeline --profile feature --kind unit [--quality --mutation …] [--json |
--mermaid out.md | --emit-model file]` — print/serialize the same pipeline headlessly.
`--emit-model` regenerates `docs/wiki/pipeline-model.json` (the demo's data — never hand-edit).
