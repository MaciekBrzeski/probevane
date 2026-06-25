---
name: probevane
description: Drive probevane — a gated agentic harness that adds, refactors, and fixes tests across React/Vue/Svelte/Node/Python/Go/Rust. Use to generate tests, run TDD features, characterization refactors, repair stale tests, review+autofix PRs, grade/benchmark suites, and produce specs/graphs. Invoke for any "add tests / refactor / fix / review my code" request on a real project.
---

# probevane

A gated agentic harness for tests + safe code change. Every run is verified by **gates** (typecheck, suite green, audit-clean, hermetic, coverage/mutation) — it only finishes when the work is real. Stacks auto-detected: React, Vue, Svelte, plain Node/TS, Python (pytest), Go (cargo→go test), Rust (cargo test).

> This file is GENERATED from `src/skill/catalog.ts` by `probevane skill`. Do not edit by hand — run `probevane skill` to regenerate. CI gates drift (`probevane skill --check`).

## Invocation

Run the CLI: `./bin/probevane <command> <dir> [flags]` (or `npx probevane …`). Most commands take a project directory and print a result; the loop commands need `ANTHROPIC_API_KEY` (or `--model local:<id>` for a local OpenAI-compatible server). Per-project defaults live in `probevane.config.{ts,json}`; CLI flags override.

## Choosing a command

- **Add tests** → `generate` (use `--mock` for networked apps, `--passk N` to keep the best of N, `--target-gaps` to chase uncovered lines).
- **Change code safely** → `refactor` (behavior preserved by the existing tests) ; **add a feature** → `feature` (TDD, red-first).
- **Tests went stale after a change** → `repair`. **Fix described bugs** → `fix`.
- **On a PR** → `ci --review-fix` (review the diff, gated, auto-fix). **Judge a suite** → `review` / `bench`.
- **Understand a repo** → `graph`, `spec`. **Mocks only** → `mock`.

## Commands

| command | what it does |
|---|---|
| `init` | Detect the stack and install test deps + config. |
| `generate` | Probe-grounded gated loop writes unit/e2e tests (mock maker, hermetic, audited). |
| `refactor` | Characterization-first refactor: change source only, every test stays green (behavior_lock). |
| `feature` | TDD red-first: write a failing test, implement, go green; existing tests protected. |
| `repair` | After source changes, update the affected (stale) tests so the whole suite is green. |
| `fix` | Apply described issues/findings to the code, keeping the suite green + audit-clean. |
| `review` | Read-only quality grade (0–100) of a suite: green, coverage, audit, flake. |
| `a11y` | Static accessibility audit of components (missing alt/name/label, click-no-role, positive tabindex) → grade. |
| `bench` | Measure a suite: coverage, audit, and mutation score (does it catch bugs?). |
| `ci` | PR helper: report changed-untested files + coverage; --generate adds tests; --review-fix reviews the diff (gated) and auto-fixes. |
| `mock` | Synthesize the mock boundary (MSW handlers, fixtures, contracts) from the module graph. |
| `graph` | Render the module dependency graph (ASCII tree + Mermaid). |
| `spec` | Generate a project SPEC.md (graph, modules, API surface, coverage); --narrate adds LLM descriptions; --wiki publishes. |
| `run` | Execute the test suite via the detected adapter. |
| `coverage` | Report coverage via the adapter. |
| `audit` | Static quality gate over the spec files (exit 1 on errors). |
| `status` | Quick dashboard: adapter, suite result, coverage. |
| `learn` | Save a spec to the cross-project learning library. |
| `eval` | Run probevane's fixture eval (self-test of the harness); --live regenerates. |
| `watch` | Watch src/ and on each save map the file → repair (has a test) or generate (none); --run triggers the loop. |
| `skill` | Generate/check the probevane control skill (this doc). --check fails on drift. |
| `distill` | Build a fine-tuning dataset from accepted-test traces (PROBEVANE_TRACES=1) and print the LoRA training plan; serve the result via --model local:. |

## Reference

### init
Detect the stack and install test deps + config.

```
probevane init <dir>
# e.g.
probevane init ./my-app
```

### generate
Probe-grounded gated loop writes unit/e2e tests (mock maker, hermetic, audited).

```
probevane generate <dir> [--kind unit|e2e] [--model auto|haiku|sonnet|opus|local:<id>] [--mock] [--mutation] [--flake-guard] [--target-gaps] [--a11y] [--passk N] [--budget N] [--only <substr>] [--spec]
# e.g.
probevane generate ./my-app --kind unit --mock
```

### refactor
Characterization-first refactor: change source only, every test stays green (behavior_lock).

```
probevane refactor <dir> --task "<what to refactor>" [--model …] [--budget N]
# e.g.
probevane refactor ./app --task "extract helpers into utils.ts"
```

### feature
TDD red-first: write a failing test, implement, go green; existing tests protected.

```
probevane feature <dir> --task "<feature>" [--model …]
# e.g.
probevane feature ./app --task "add a discount field to cartTotal"
```

### repair
After source changes, update the affected (stale) tests so the whole suite is green.

```
probevane repair <dir> [--since <ref>] [--model …]
# e.g.
probevane repair ./app --since HEAD~1
```

### fix
Apply described issues/findings to the code, keeping the suite green + audit-clean.

```
probevane fix <dir> --task "<issues>" [--model …]
# e.g.
probevane fix ./app --task "handle the null case in parse()"
```

### review
Read-only quality grade (0–100) of a suite: green, coverage, audit, flake.

```
probevane review <dir> [--flake N]
# e.g.
probevane review ./app
```

### a11y
Static accessibility audit of components (missing alt/name/label, click-no-role, positive tabindex) → grade.

```
probevane a11y <dir>
# e.g.
probevane a11y ./app
```

### bench
Measure a suite: coverage, audit, and mutation score (does it catch bugs?).

```
probevane bench <dir> [--mutants N]
# e.g.
probevane bench ./app --mutants 6
```

### ci
PR helper: report changed-untested files + coverage; --generate adds tests; --review-fix reviews the diff (gated) and auto-fixes.

```
probevane ci <dir> [--base <ref>] [--generate] [--review-fix] [--strict]
# e.g.
probevane ci . --base origin/main --review-fix
```

### mock
Synthesize the mock boundary (MSW handlers, fixtures, contracts) from the module graph.

```
probevane mock <dir>
# e.g.
probevane mock ./app
```

### graph
Render the module dependency graph (ASCII tree + Mermaid).

```
probevane graph <dir> [--mermaid <file>]
# e.g.
probevane graph ./app --mermaid graph.md
```

### spec
Generate a project SPEC.md (graph, modules, API surface, coverage); --narrate adds LLM descriptions; --wiki publishes.

```
probevane spec <dir> [--narrate] [--out <file>] [--wiki]
# e.g.
probevane spec ./app --narrate
```

### run
Execute the test suite via the detected adapter.

```
probevane run <dir> [--scope unit|e2e|all]
# e.g.
probevane run ./app --scope unit
```

### coverage
Report coverage via the adapter.

```
probevane coverage <dir>
# e.g.
probevane coverage ./app
```

### audit
Static quality gate over the spec files (exit 1 on errors).

```
probevane audit <dir>
# e.g.
probevane audit ./app
```

### status
Quick dashboard: adapter, suite result, coverage.

```
probevane status <dir>
# e.g.
probevane status ./app
```

### learn
Save a spec to the cross-project learning library.

```
probevane learn <dir> --file <spec> --category <c> [--kind] [--bad]
# e.g.
probevane learn ./app --file src/x.test.ts --category crud
```

### eval
Run probevane's fixture eval (self-test of the harness); --live regenerates.

```
probevane eval [--live] [--flake N]
# e.g.
probevane eval
```

### watch
Watch src/ and on each save map the file → repair (has a test) or generate (none); --run triggers the loop.

```
probevane watch <dir> [--run] [--debounce ms]
# e.g.
probevane watch ./app --run
```

### skill
Generate/check the probevane control skill (this doc). --check fails on drift.

```
probevane skill [--check]
# e.g.
probevane skill --check
```

### distill
Build a fine-tuning dataset from accepted-test traces (PROBEVANE_TRACES=1) and print the LoRA training plan; serve the result via --model local:.

```
probevane distill <build|stats|train|bases> [--execute] [--models a,b]
# e.g.
probevane distill build
```

## Safety + cost

- All loop commands are **gated**: they cannot finish red, audit-broken, non-hermetic, or below coverage. Issue-discovery (`review`) is itself gated — findings are grounded + adversarially verified before any auto-fix.
- `--budget N` caps output tokens (a stuck loop stops). `--model auto` routes complex code to a stronger model up front (cheaper than churning a weak one).
- Runs never edit `node_modules`/build/lockfiles (path_guard) and never weaken existing tests.
