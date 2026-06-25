# CLAUDE.md — probevane

Unified agentic harness that adds **unit + e2e tests** to a project. Distills three prior assets (do not modify them — patterns were ported):
- **qaforge** — test-gen craft (audit rules, prompt patterns, learning library).
- **runestone** — gated agentic loop (Runes: plan_first / validation_gate / acceptance_gate / audit_gate). Accept only when all gates green.
- **fourier-nca** — measured eval: control (fixture) + intervention (run) vs baseline; append-only improvement-log; honest negatives.

## Architecture
- `src/adapters/` — the modularity contract (`adapter.ts`). Everything language/framework-specific lives behind `StackAdapter`. First-class: `react-vitest-playwright`. Stub: `python-pytest`. Adding a stack = one folder + audit rules; loop/library/eval untouched.
- `src/loop/` — the gated loop (P1+): rune contract + engine ported from runestone.
- `src/brain/` — the LLM driver (P1+): anthropic-sdk default, claude-code alt.
- `src/audit/` — language-agnostic rule engine (`core.ts`, P2) + per-language rules.
- `src/library/` — cross-project learning library at `~/.local/share/probevane/` + append-only `improvement-log`.
- `fixtures/` — zero-/low-test apps the harness runs against (eval inputs).
- `eval/` — the harness's own test suite: `cases.jsonl`, runner/scorer, `baseline/`, `improvement-log.csv`.

## Conventions
- ESM TypeScript, run via `tsx` (no build step needed). Node 22+.
- CLI: `./bin/probevane <cmd> <dir>`. Commands: init, plan, generate, run, audit, coverage, learn, eval, status.
- Adapters never let the model guess: `probe()` gathers ground truth first; a failed probe is a hard `plan_first` block.
- improvement-log is append-only (fourier rule). Failing eval cases stay flagged, never deleted.

## Phase status
ALL phases (P0–P6) complete. React (unit+e2e) and Python (unit) adapters; gated write_tests loop = context_inject → path_guard → plan_first → no_regression → validation_gate → audit_gate → acceptance_gate → session_diary → caveat_harvest, with a consult ladder + Sonnet takeover on stalls. Self-eval CI over 3 fixtures. Proven on a fresh unseen React app (0→22 unit @100% cov + 5 e2e @0 flake) and Python (0→22 pytest). Living wiki: `npm run wiki`. Full record in `docs/wiki/Phase-Log.md`; plan at `/home/wruszbit/.claude/plans/hi-we-recently-had-jaunty-axolotl.md`.
