# Task paths

probevane is no longer only a test-adder. Each **path** is a CLI + a rune profile (`src/loop/profiles.ts`); they share the loop, mock maker, gates, model routing, and config.

| Path | CLI | Discipline | Key gate |
|---|---|---|---|
| **write tests** | `generate` | probe-grounded, hermetic, mock-backed | validation + audit + hermetic + acceptance |
| **refactor** | `refactor --task` | characterization-first | `behavior_lock` |
| **feature** | `feature --task` | TDD red-first | `red_first` |
| **repair** | `repair --since <ref>` | git-diff → update stale specs | full-suite `validation_gate` |

## refactor — `behavior_lock`
The existing test suite is the contract. The rune (`src/loop/runes/behavior_lock.ts`) snapshots the passing set at `prepare`, **blocks edits/deletes of any test file** (`beforeToolCall`), and only allows finishing once the **source actually changed** and **every previously-passing test still passes** + typecheck clean (`shouldStop`). Run `generate` first if the target has no tests.

## feature — `red_first`
TDD. The rune (`red_first.ts`) **blocks all source edits until a NEW test exists that fails** against the current code (`afterToolCall` runs the new spec; a red result unlocks source). `shouldStop` refuses to finish unless a red-then-green test was observed. Pre-existing tests stay green (`no_regression`).

## repair
`git diff` finds changed source (`src/git.ts`), maps each to its sibling specs (`specCandidatesFor`), and the model updates **only the affected tests** to match new behavior — the whole suite must end green (`validation_gate('unit', full=true)`).

## Engine improvements feeding the paths
- **Coverage-gap targeting** (`--target-gaps`): `src/coverage/gaps.ts` parses `coverage-final.json` → exact uncovered lines/fns, injected so the model aims at the gaps.
- **Flake hunter** (`--flake-guard`): `flake_gate` runs the new specs N× and rejects non-determinism.
- **Mutation gate** (`--mutation`): mutates source, requires the suite to kill the mutants.
- **AST probe**: ts-morph gives accurate exports/params/types/props (`src/adapters/ast-probe.ts`), regex fallback.

## Config + reach
- `probevane.config.{ts,json}` (`src/config.ts`): per-project `model / kind / minTests / minCoverage / mock / mutation / flakeGuard …`. Precedence: flag > config > default.
- **Local model** (`--model local:<id>`): OpenAI-compatible backend (`src/brain/openai-compat.ts`) for Ollama/vLLM/llama.cpp.
- **Stacks**: React, Vue, **Svelte**, Python, **Go** — 5 stacks, 3 languages, all self-scoring in CI.
- **CI Action** (`action.yml` + `probevane ci`): on a PR, report changed-but-untested files + coverage, optionally generate the missing tests and comment.

> Note: the path gate logic is verified deterministically (each rune unit-exercised). End-to-end live runs (the LLM doing the refactor/feature) need API credits.
