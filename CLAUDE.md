# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# probevane

Unified agentic harness that adds **unit + e2e tests** to a project (plus feature/refactor/repair/review task paths). Distills three prior assets (do not modify them — patterns were ported, not vendored):
- **qaforge** — test-gen craft (audit rules, prompt patterns, learning library).
- **runestone** — gated agentic loop (Runes). Accept only when all gates green.
- **fourier-nca** — measured eval: fixture baselines, append-only improvement-log, honest negatives.

ESM TypeScript, Node 22+, run via `tsx` — no build step needed for dev (`npm run build` / esbuild → `dist/` only for publishing; `bin/probevane` prefers `dist/`, falls back to `tsx src/cli/`).

## Commands

```sh
npm test                                   # vitest run (tests/ + src/**/*.test.ts)
npx vitest run tests/foo.test.ts -t "name" # single test
npm run typecheck                          # tsc --noEmit && tsc -p src/ui
npm run coverage                           # v8; floors: stmts/lines/branches 90, funcs 85 — raise as coverage climbs, NEVER lower to make a red run pass
npm run test:e2e                           # playwright, testDir e2e-dash/ (own dashboard + visual snapshots)
npm run eval                               # self-eval over fixtures/ vs eval/baseline/ ($0, no LLM); --live regenerates, --paths replays cassettes
npm run engine:gate                        # vendored engine/ workspaces: lint + typecheck + test
npm run bench:ui                           # UI perf numbers (render frame time, diff-flush ratio, bundle size)
npm run smoke                              # smoke-test the built dist/
npm run wiki                               # living wiki server over docs/wiki/
npm run build:ui                           # TSX sources (src/ui/app/) → generated src/ui/control.html; --check = CI drift gate
PROBEVANE_UI_DEV=1 ./bin/probevane daemon  # control center at :7766; dev mode recompiles TSX per request
./bin/probevane <cmd> <dir>                # the CLI itself; dogfood with `./bin/probevane generate fixtures/react-todo`
```

CI (`.github/workflows/ci.yml`) dogfoods the harness on itself: typecheck → coverage floors → dist build → `skill --check` drift gate → `quality . --strict` → `mutation . --min-score 0.6` → dashboard e2e → UI perf gate → fixture + path eval.

## Architecture

The driving triad is **Adapter + Runes + Brain**, orchestrated by the loop engine. Everything else hangs off it.

- `src/adapters/` — the modularity seam (`adapter.ts`). Everything language/framework-specific lives behind `StackAdapter`: `detect`, `install`, `discover`, `probe` (ground truth before generation), `run`, `coverage`, `guidance`/`patternsDoc` (few-shot), `auditRules`, `commands` (shell strings the gates run). `registry.ts` picks the highest `detect()` score. First-class: `react-vitest-playwright` (unit+e2e). Also real: `python-pytest`, `vue-vitest-playwright`, `svelte-vitest`, `node-vitest`, `go-test`, `rust-cargo`, `angular`. Adding a stack = one folder + audit rules; loop/library/eval untouched. Monorepo note: `node-vitest` detects a workspace sub-package by its vitest.config (deps hoist to the root, so the sub-package's `package.json` looks empty) and skips redundant vitest install.
- `src/loop/` — the gated engine (`engine.ts` + `engine-phases.ts`/`engine-escalation.ts`/`engine-prompts.ts`). Per step: system prompt (base + Rune additions + RAG) → Brain completes → Runes veto tool calls (`beforeToolCall`, first Block wins) → on stop-intent, `shouldStop` gates run in order; first Block injects feedback and continues; all-allow = ACCEPT. `profiles.ts` composes ordered Rune pipelines per task (`write_tests`, `feature`, `repair`, `refactor`, `document`, `visual`, …); `runes/` holds them: preamble (context_inject, path_guard, plan_first, no_regression, red_first, behavior_lock, mock_inject) → green gates (validation_gate, audit_gate, hermetic_gate, acceptance_gate) → opt-in (mutation/flake/a11y/visual/render/quality/mfe/assertion gates) → harvest (session_diary, caveat_harvest, library_promote, distill_trace). Escalation: consult ladder + stronger-model takeover on stalls. Task paths route via `src/cli/path-cli.ts` → `run-path.ts`; `--worktree` runs in a throwaway git worktree, live tree untouched until `--worktree-merge`/`--worktree-review`. The `visual` path's acceptance oracle is not test counts: `render_gate` rebuilds, screenshots the live app (`src/visual/capture.ts`), optionally checks a perf budget, then a vision model judges PASS/FAIL (adversarial majority via `--vision-votes`), critique fed back on Block.
- `src/brain/` — LLM driver behind one interface (`brain.ts: complete()`); `select.ts` resolves `--model`: anthropic-sdk (default), `claude-code`, `openai:`/`local:`/`ollama`, `replay:<cassette>` (deterministic offline), and **`bridge`** ($0 mode: writes API-shaped requests to `<state>/bridge/req-*.json`, an external Claude Code session answers via `res-*.json` — see the `probevane-brain` skill/agent).
- `src/audit/` — language-agnostic rule engine (`core.ts`; suppress with `probevane-allow: <rule-id>`) + per-language rules.
- `src/library/` — cross-project learning library (append-only `index.jsonl` + graded markdown examples), stack-scoped retrieval feeding `context_inject`; fed by `library_promote`.
- `eval/` + `fixtures/` — the harness's own measured eval: `cases.jsonl`/`path-cases.jsonl`, `scorer.ts`, `baseline/`, replay `cassettes/`, append-only `improvement-log.csv`.
- `src/ui/` — the control center: TSX components in `app/` compiled by `scripts/build-ui.mjs` into the GENERATED, drift-gated `control.html` (never hand-edit). No framework: `runtime.ts` h() builds real DOM. Convention over imports — `<X/>` resolves to `app/components/X.tsx` at compile time (missing file = build error; local `h`/`Fragment` = build error). Console tab: live rune-pipeline light show + theater replay (`<state>/events/<runId>.jsonl` durable sink, `/events?runId`). See `docs/wiki/Control-Center.md` + ADR-015.
- Supporting subsystems (one line each): `review/` LLM diff-review with 2-gate adversarial verification of findings; `quality/` heuristic source-quality analyzer + baseline ratchet (JS/TS + Python AST); `mock/` MSW/mock-boundary synthesis for hermetic tests; `visual/` screenshot capture + vision judge + design/improve loops (feeds `render_gate` and the `design`/`improve` commands); `planner/` feature planner — a local model fills the middle between CURRENT and DESIRED state via literal FIM with chat fallback (`plan-feature`); `spec-run/` RunSpec — persisted schema-validated run specification: classify an NL prompt into path+flags (`intake`), decompose a repo into per-file single-target units, drive the **dark factory** (`factory-dark`: intake → decompose → enqueue on the supervisor queue; deterministic give-ups parked, only transient errors backoff-retry); `factory/` fleet runner over many repos (isolated state each); `observe/` + `server/` daemon/dashboard/queue; `cost/` per-run ledger + budgets; `distill/` trace capture → fine-tune dataset → auto-promote via `<state>/model.json`; `mfe/` Module Federation audit/contract tests; `tui/` terminal dashboards. Single-command backends live under `src/commands/`: `arch` (report-only, cost-aware structural critique — first-pass ranker, verify before acting, ADR-019; `--pyramid` scores the tree against the pyramid model: isolated feature pyramids on a glue base, shared dirs as common floor), `ship` (accepted run → branch → PR, never touches default branch), `spec` (SPEC.md from module graph + probes), `skill` (command catalog → SKILL.md + wiki), `doctor`, `search`, `plan`, `ado`.
- `engine/` — the vendored facet drawing engine (npm workspaces `@facet/core`, `render-term`, `render-dom`, `gallery`); TUI and UI draw through it. Own gate: `npm run engine:gate` (lint + typecheck + test per workspace). The module graph scans workspaces and resolves their package-name imports, so engine is a first-class `shared` dir in the pyramid model (probevane.config `arch.shared`).

**Domain map** (logical grouping over the mostly-flat `src/`, see [Architecture](docs/wiki/Architecture.md)): **the loop** `loop`·`brain`·`adapters`·`mock`·`planner` · **gates & analysis** `audit`·`quality`·`review`·`mfe`·`visual`·`coverage`·`e2e` · **presentation** `ui`·`tui` (draw through `engine/` facet) · **ops & fleet** `server`·`observe`·`factory`·`spec-run` · **knowledge & docs** `library`·`distill` · **command backends** `commands/` (arch, ship, spec, skill, doctor, search, plan, ado) · **composition root** `cli` (imports ~all; stays at root for `bin`/dist dispatch) · **shared leaves** `util` (incl. `config.ts`, `git.ts`)·`cost`. Full physical regrouping was declined (735 aliasless relative imports + dist-mirror dispatch); only the cheap wins landed — single-command backends into `commands/`, `config.ts`/`git.ts` into `util/`.

State root: `PROBEVANE_STATE ?? ~/.local/share/probevane` (library, `runs.jsonl` ledger, bridge queue, model pointer). Per-run logs in `<dir>/.probevane/` (events + transcript jsonl). Config: `probevane.config.{ts,js,mjs,json}` in the **target** dir, schema-validated; precedence flag > config > default.

## Conventions

- Adapters never let the model guess: `probe()` gathers ground truth first; a failed probe is a hard `plan_first` block.
- improvement-log is append-only (fourier rule). Failing eval cases stay flagged, never deleted.
- Default gates measure **well-formedness** (green, anti-patterns, min count, coverage %). The **correctness** floor — does the suite actually catch bugs? — is the mutation gate, opt-in via `--strict` (or `strict: true` config) and default-on in self-eval CI. `--strict` also steers the model to kill surviving mutants. Budget-capped + advisory on timeout (never a false block / CI deadlock).
- Generated files are drift-gated, don't hand-edit: `src/commands/skill/catalog.ts` is the command source of truth → `.claude/skills/probevane/SKILL.md` + `docs/wiki/Commands.md` (CI `skill --check`). `docs/probevane-guide.md` is docs-loop output, reference-integrity gated.
- Concurrent/factory/bridge runs must set `PROBEVANE_STATE` so ledgers/traces/bridge queues never collide.

## Phase status

ALL phases (P0–P6) complete; post-phase growth added the extra adapters, task paths, daemon/factory/review/quality/distill subsystems. Proven on a fresh unseen React app (0→22 unit @100% cov + 5 e2e @0 flake) and Python (0→22 pytest). Full record in `docs/wiki/Phase-Log.md`; long-form guide `docs/probevane-guide.md`; plan at `/home/wruszbit/.claude/plans/hi-we-recently-had-jaunty-axolotl.md`.
