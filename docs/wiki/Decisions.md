# Decisions (ADR)

Short architecture decision records. Newest first.

## ADR-012 — Isolate (self-)improvement in a worktree; review before merge
**Decision:** `--worktree` runs a path loop in a throwaway git worktree on its own branch (live tree untouched until an explicit merge); it symlinks every `node_modules` (root + nested) in, commits only `outcome.editedFiles` on accept (never `git add -A`), and self-reviews the committed diff — `--worktree-merge` blocks the auto-merge on any review `error`. The $0 bridge servicer is a first-class agent (`probevane-brain`) whose discipline is to adapt to gate feedback. **Why:** refactoring probevane *in place* while the loop runs on it is self-modifying risk, and a green suite can't catch a dropped case — so isolation + a review gate make self-improvement safe and give a clean before/after. The `-A` ban is hard-won: an early hand-run committed the worktree's `node_modules` symlink and clobbered real deps on merge. A *deterministic* servicer can't react to gate feedback and stalls, so adaptiveness is the agent's core rule. See [Worktree mode](Worktree.md).

## ADR-011 — On a real app, validate only the tests we wrote
**Decision:** `validation_gate`/`acceptance_gate` run scoped to the new spec files (`run(dir, scope, files)`), and `validation_gate` relaxes typecheck if the project didn't typecheck cleanly at baseline. `discover` ranks targets by testability; the MSW setup patch preserves the jest-dom import. **Why:** real apps ship their own (often jest-era, env-incompatible) tests and may not typecheck under our config — none of that is ours to fix when *adding* tests. Whole-suite-green would make acceptance impossible; scoping to our specs makes "did we add good tests?" the real question. Proven: 22 passing tests generated on a production app's redux slices.

## ADR-010 — Mock the boundary; chain contracts along the graph
**Decision:** a deterministic mock maker (`src/mock/`) synthesizes a module's input boundary (network→MSW from OpenAPI/types, dep `vi.mock`, prop fixtures, fake time), starts MSW globally so specs need only async waiting, and threads each module's captured output as the next module's input fixture (single `test-fixtures/*.json` source of truth). **Why:** real apps are multi-module + networked — you can't test a component without faking its inputs, and re-mocking each module independently drifts. Capturing the upstream's frozen output and asserting it downstream keeps the chain coherent. `hermetic_gate` enforces the mocks are actually used.

## ADR-009 — Cache the stable prefix; cap + prune the rest
**Decision:** mark the system+tools prefix `cache_control: ephemeral`; cap command output (head+tail) and prune tool-result bodies older than 8 turns. **Why:** the system block (base + runes + RAG + tools) repeats every turn and dominated input tokens. Caching it cut billed input ~40% with zero behavior change; capping/pruning bounds the growing transcript.

## ADR-008 — path_guard: deps live inside the project
**Decision:** a `path_guard` rune denies writes/deletes to `node_modules`, build dirs, and lockfiles; it's first in the `write_tests` pipeline. **Why:** `tools.ts` blocks absolute paths and `..` escapes, but `node_modules` is *inside* the project dir, so those guards let it through. A real run proved the risk — a model stuck on a typecheck failure "fixed" it by overwriting `node_modules/.bin/tsc`, corrupting the toolchain. The scope a model can damage must be fenced explicitly.

## ADR-007 — Stack-knowledge belongs in the adapter, not the core
**Decision:** spec-file discovery, generation guidance, and test patterns are adapter methods (`specFiles`/`guidance`/`patternsDoc`), not core constants. **Why:** adding the python stack revealed these were implicitly JS/React in the core (the `*.spec.ts` regex, the vitest placement string, `unit-patterns.md`). Pushing them behind the contract kept the loop/gates/scorer/library stack-agnostic; the python adapter then dropped in and a 3rd stack needs zero core edits. The modularity test exists precisely to surface this kind of hidden coupling.

## ADR-006 — Stop-to-validate needs a nudge + a delete tool
**Decision:** give the brain a `delete_file` tool and, when `barren` hits the ceiling, inject one nudge telling it to finish (stop calling tools) or clean up — before giving up. **Why:** `validation_gate` is a `shouldStop` gate, so it only runs when the model *attempts to finish*. A model that keeps tinkering never triggers the feedback loop; it also stranded empty placeholder files it couldn't remove. The nudge converts blind tinkering into stop→validate→fix; the delete tool lets it clear leftovers. Observed: a 22-step/160k-token stuck run became 6 steps/27k tokens, 100% coverage.

## ADR-005 — Living wiki, served zero-dep
**Decision:** docs as markdown under `docs/wiki/`, served by a dependency-free node script (`scripts/wiki.mjs`, marked via CDN). **Why:** browseable without a build or extra deps; renders on GitHub too; updated every phase.

## ADR-004 — Anthropic SDK brain, Haiku default
**Decision:** default brain calls the native Anthropic Messages API with `claude-haiku-4-5-20251001`; retries on 429/529/5xx. **Why:** the loop depends on reliable per-turn tool calls, which the Max-plan `claude -p` path can't do; Haiku is fast/cheap and tool-capable. `claude-code` stays a possible alternate for review/takeover. **Risk:** bills API credits.

## ADR-003 — Tests are a gate, not a tool
**Decision:** the model gets read/list/write/edit/plan tools, but **not** a "run tests" tool; the suite is run by `validation_gate.shouldStop`. **Why:** "done" must mean "the whole suite is green now", not "a partial run looked green". Prevents the model from stopping early.

## ADR-002 — Port runestone's contract to TS, don't embed the binary
**Decision:** re-implement the Rune contract + loop in ~400 LOC TypeScript rather than embedding the Rust runestone. **Why:** the first-class targets (React/vitest/Playwright) and qaforge's proven test-gen logic are TS; a Rust core would force FFI/subprocess bridges and kill the reuse story. Runestone's value is its *shape*, which ports cleanly.

## ADR-001 — New unified harness, adapter-modular
**Decision:** build a new tool (not extend qaforge/qa-harness-template), with all stack-specifics behind a `StackAdapter`. React first; pytest stub proves drop-in. **Why:** user wants one transferable harness; the three assets overlap but none is the union. Modularity is the transferability mechanism.
