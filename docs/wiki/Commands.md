# Commands

_Generated from `src/skill/catalog.ts` by `probevane skill` — do not edit by hand. CI gates drift._

The CLI is `./bin/probevane <command> <dir> [flags]`. Loop commands need `ANTHROPIC_API_KEY` (or `--model local:<id>`). See [CLI](CLI.md) for the narrative intro and [Paths](Paths.md) for the task paths.

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

```bash
probevane init <dir>
# e.g. probevane init ./my-app
```

### generate
Probe-grounded gated loop writes unit/e2e tests (mock maker, hermetic, audited).

```bash
probevane generate <dir> [--kind unit|e2e] [--model auto|haiku|sonnet|opus|local:<id>] [--mock] [--mutation] [--flake-guard] [--target-gaps] [--a11y] [--passk N] [--budget N] [--only <substr>] [--spec]
# e.g. probevane generate ./my-app --kind unit --mock
```

### refactor
Characterization-first refactor: change source only, every test stays green (behavior_lock).

```bash
probevane refactor <dir> --task "<what to refactor>" [--model …] [--budget N]
# e.g. probevane refactor ./app --task "extract helpers into utils.ts"
```

### feature
TDD red-first: write a failing test, implement, go green; existing tests protected.

```bash
probevane feature <dir> --task "<feature>" [--model …]
# e.g. probevane feature ./app --task "add a discount field to cartTotal"
```

### repair
After source changes, update the affected (stale) tests so the whole suite is green.

```bash
probevane repair <dir> [--since <ref>] [--model …]
# e.g. probevane repair ./app --since HEAD~1
```

### fix
Apply described issues/findings to the code, keeping the suite green + audit-clean.

```bash
probevane fix <dir> --task "<issues>" [--model …]
# e.g. probevane fix ./app --task "handle the null case in parse()"
```

### review
Read-only quality grade (0–100) of a suite: green, coverage, audit, flake.

```bash
probevane review <dir> [--flake N]
# e.g. probevane review ./app
```

### a11y
Static accessibility audit of components (missing alt/name/label, click-no-role, positive tabindex) → grade.

```bash
probevane a11y <dir>
# e.g. probevane a11y ./app
```

### bench
Measure a suite: coverage, audit, and mutation score (does it catch bugs?).

```bash
probevane bench <dir> [--mutants N]
# e.g. probevane bench ./app --mutants 6
```

### ci
PR helper: report changed-untested files + coverage; --generate adds tests; --review-fix reviews the diff (gated) and auto-fixes.

```bash
probevane ci <dir> [--base <ref>] [--generate] [--review-fix] [--strict]
# e.g. probevane ci . --base origin/main --review-fix
```

### mock
Synthesize the mock boundary (MSW handlers, fixtures, contracts) from the module graph.

```bash
probevane mock <dir>
# e.g. probevane mock ./app
```

### graph
Render the module dependency graph (ASCII tree + Mermaid).

```bash
probevane graph <dir> [--mermaid <file>]
# e.g. probevane graph ./app --mermaid graph.md
```

### spec
Generate a project SPEC.md (graph, modules, API surface, coverage); --narrate adds LLM descriptions; --wiki publishes.

```bash
probevane spec <dir> [--narrate] [--out <file>] [--wiki]
# e.g. probevane spec ./app --narrate
```

### run
Execute the test suite via the detected adapter.

```bash
probevane run <dir> [--scope unit|e2e|all]
# e.g. probevane run ./app --scope unit
```

### coverage
Report coverage via the adapter.

```bash
probevane coverage <dir>
# e.g. probevane coverage ./app
```

### audit
Static quality gate over the spec files (exit 1 on errors).

```bash
probevane audit <dir>
# e.g. probevane audit ./app
```

### status
Quick dashboard: adapter, suite result, coverage.

```bash
probevane status <dir>
# e.g. probevane status ./app
```

### learn
Save a spec to the cross-project learning library.

```bash
probevane learn <dir> --file <spec> --category <c> [--kind] [--bad]
# e.g. probevane learn ./app --file src/x.test.ts --category crud
```

### eval
Run probevane's fixture eval (self-test of the harness); --live regenerates.

```bash
probevane eval [--live] [--flake N]
# e.g. probevane eval
```

### watch
Watch src/ and on each save map the file → repair (has a test) or generate (none); --run triggers the loop.

```bash
probevane watch <dir> [--run] [--debounce ms]
# e.g. probevane watch ./app --run
```

### skill
Generate/check the probevane control skill (this doc). --check fails on drift.

```bash
probevane skill [--check]
# e.g. probevane skill --check
```

### distill
Build a fine-tuning dataset from accepted-test traces (PROBEVANE_TRACES=1) and print the LoRA training plan; serve the result via --model local:.

```bash
probevane distill <build|stats|train|bases> [--execute] [--models a,b]
# e.g. probevane distill build
```
