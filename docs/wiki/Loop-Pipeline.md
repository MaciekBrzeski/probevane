# Loop pipeline

probevane's loop is assembled from modular **Runes** — small gate/harness plugins hooked
into fixed points of the loop. The set + order is a **pure function of the config**
(`profile(name, opts)` in `src/loop/profiles.ts`), so a chosen configuration's pipeline is
fully derivable without running anything.

→ **[Loop pipeline (demo)](/demo/pipeline)** — an interactive configurator: pick a profile,
toggle gates, set params, and see the runes it assembles as a phase-grouped graph. Paste a
`probevane.config.json` to see how *that* config looks.

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

## Profiles

`write_tests` · `feature` (TDD red-first) · `refactor` · `repair` · `fix` · `migrate` ·
`document` · `bare`. Gate toggles (quality / mutation / flake / assertion / a11y / visual /
mfe) add runes; numeric/model knobs (maxSteps / minTests / minCoverage / budget / model)
tune parameters but don't change which runes run.

## CLI

`probevane pipeline --profile feature --kind unit [--quality --mutation …] [--json |
--mermaid out.md | --emit-model file]` — print/serialize the same pipeline headlessly.
`--emit-model` regenerates `docs/wiki/pipeline-model.json` (the demo's data — never hand-edit).
