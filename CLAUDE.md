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
npm run typecheck                          # tsc --noEmit
npm run coverage                           # v8; floors: stmts/lines/branches 90, funcs 85 — raise as coverage climbs, NEVER lower to make a red run pass
npm run test:e2e                           # playwright, testDir e2e-dash/ (own dashboard + visual snapshots)
npm run eval                               # self-eval over fixtures/ vs eval/baseline/ ($0, no LLM); --live regenerates, --paths replays cassettes
npm run wiki                               # living wiki server over docs/wiki/
./bin/probevane <cmd> <dir>                # the CLI itself; dogfood with `./bin/probevane generate fixtures/react-todo`
```

CI (`.github/workflows/ci.yml`) dogfoods the harness on itself: typecheck → coverage floors → dist build → `skill --check` drift gate → `quality . --strict` → `mutation . --min-score 0.5` → dashboard e2e → fixture + path eval.

## Architecture

The driving triad is **Adapter + Runes + Brain**, orchestrated by the loop engine. Everything else hangs off it.

- `src/adapters/` — the modularity seam (`adapter.ts`). Everything language/framework-specific lives behind `StackAdapter`: `detect`, `install`, `discover`, `probe` (ground truth before generation), `run`, `coverage`, `guidance`/`patternsDoc` (few-shot), `auditRules`, `commands` (shell strings the gates run). `registry.ts` picks the highest `detect()` score. First-class: `react-vitest-playwright` (unit+e2e). Also real: `python-pytest`, `vue-vitest-playwright`, `svelte-vitest`, `node-vitest`, `go-test`, `rust-cargo`, `angular`. Adding a stack = one folder + audit rules; loop/library/eval untouched.
- `src/loop/` — the gated engine (`engine.ts` + `engine-phases/escalation/prompts.ts`). Per step: system prompt (base + Rune additions + RAG) → Brain completes → Runes veto tool calls (`beforeToolCall`, first Block wins) → on stop-intent, `shouldStop` gates run in order; first Block injects feedback and continues; all-allow = ACCEPT. `profiles.ts` composes ordered Rune pipelines per task (`write_tests`, `feature`, `repair`, `refactor`, `document`, …); `runes/` holds them: preamble (context_inject, path_guard, plan_first, no_regression, red_first, behavior_lock) → green gates (validation_gate, audit_gate, hermetic_gate, acceptance_gate) → opt-in (mutation/flake/a11y/visual/quality/mfe gates) → harvest (session_diary, caveat_harvest, library_promote). Escalation: consult ladder + stronger-model takeover on stalls. Task paths route via `src/cli/path-cli.ts` → `run-path.ts`; `--worktree` runs in a throwaway git worktree, live tree untouched until `--worktree-merge`/`--worktree-review`.
- `src/brain/` — LLM driver behind one interface (`brain.ts: complete()`); `select.ts` resolves `--model`: anthropic-sdk (default), `claude-code`, `openai:`/`local:`/`ollama`, `replay:<cassette>` (deterministic offline), and **`bridge`** ($0 mode: writes API-shaped requests to `<state>/bridge/req-*.json`, an external Claude Code session answers via `res-*.json` — see the `probevane-brain` skill/agent).
- `src/audit/` — language-agnostic rule engine (`core.ts`; suppress with `probevane-allow: <rule-id>`) + per-language rules.
- `src/library/` — cross-project learning library (append-only `index.jsonl` + graded markdown examples), stack-scoped retrieval feeding `context_inject`; fed by `library_promote`.
- `eval/` + `fixtures/` — the harness's own measured eval: `cases.jsonl`/`path-cases.jsonl`, `scorer.ts`, `baseline/`, replay `cassettes/`, append-only `improvement-log.csv`.
- Supporting subsystems (one line each): `review/` LLM diff-review with 2-gate adversarial verification of findings; `quality/` heuristic source-quality analyzer + baseline ratchet; `mock/` MSW/mock-boundary synthesis for hermetic tests; `spec/` SPEC.md generation from module graph + probes; `factory/` fleet runner over many repos (isolated state each); `observe/` + `server/` daemon/dashboard/queue; `cost/` per-run ledger + budgets; `distill/` trace capture → fine-tune dataset → auto-promote via `<state>/model.json`; `ship/` accepted run → branch → PR (never touches default branch); `mfe/` Module Federation audit/contract tests; `arch/` report-only structural critique; `skill/` command catalog (source of truth) → SKILL.md + wiki.

State root: `PROBEVANE_STATE ?? ~/.local/share/probevane` (library, `runs.jsonl` ledger, bridge queue, model pointer). Per-run logs in `<dir>/.probevane/` (events + transcript jsonl). Config: `probevane.config.{ts,js,mjs,json}` in the **target** dir, schema-validated; precedence flag > config > default.

## Conventions

- Adapters never let the model guess: `probe()` gathers ground truth first; a failed probe is a hard `plan_first` block.
- improvement-log is append-only (fourier rule). Failing eval cases stay flagged, never deleted.
- Default gates measure **well-formedness** (green, anti-patterns, min count, coverage %). The **correctness** floor — does the suite actually catch bugs? — is the mutation gate, opt-in via `--strict` (or `strict: true` config) and default-on in self-eval CI. `--strict` also steers the model to kill surviving mutants. Budget-capped + advisory on timeout (never a false block / CI deadlock).
- Generated files are drift-gated, don't hand-edit: `src/skill/catalog.ts` is the command source of truth → `.claude/skills/probevane/SKILL.md` + `docs/wiki/Commands.md` (CI `skill --check`). `docs/probevane-guide.md` is docs-loop output, reference-integrity gated.
- Concurrent/factory/bridge runs must set `PROBEVANE_STATE` so ledgers/traces/bridge queues never collide.

## Phase status

ALL phases (P0–P6) complete; post-phase growth added the extra adapters, task paths, daemon/factory/review/quality/distill subsystems. Proven on a fresh unseen React app (0→22 unit @100% cov + 5 e2e @0 flake) and Python (0→22 pytest). Full record in `docs/wiki/Phase-Log.md`; long-form guide `docs/probevane-guide.md`; plan at `/home/wruszbit/.claude/plans/hi-we-recently-had-jaunty-axolotl.md`.
