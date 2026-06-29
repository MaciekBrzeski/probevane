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
| `plan` | Read-only action plan ($0, no LLM) — untested targets + coverage gaps + source-quality errors + MFE standards errors → a prioritized generate/refactor/fix/mfe-fix to-do list. The map before pointing the loop at a repo. |
| `generate` | Probe-grounded gated loop writes unit/e2e tests (mock maker, hermetic, audited). |
| `refactor` | Characterization-first refactor: change source only, every test stays green (behavior_lock). --quality adds a source-quality gate (edited files mustn't regress). |
| `feature` | TDD red-first: write a failing test, implement, go green; existing tests protected. --quality gates edited-source quality. |
| `repair` | After source changes, update the affected (stale) tests so the whole suite is green. --quality gates edited-source quality. |
| `fix` | Apply described issues/findings to the code, keeping the suite green + audit-clean. --quality gates edited-source quality. |
| `migrate` | Codemod / framework-version migration: change source to the new API/version while every existing test stays green (behavior_lock). --quality/--mfe gates optional; run repair after if expectations legitimately change. |
| `document` | Add documentation only — JSDoc/TSDoc on exported APIs + comments on non-obvious logic; no behavior change (tests + typecheck stay green). --only focuses one area. |
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
| `improve-cycle` | Close the self-improvement loop — promote a model as the loop default (writes <state>/model.json, which generate reads when no --model/config given), or --compare two eval results and promote the better (higher acceptance, then lower cost). LoRA training stays distill train --execute; this auto-measures/auto-promotes. |
| `distill` | Build a fine-tuning dataset from accepted-test traces (PROBEVANE_TRACES=1) and print the LoRA training plan; serve the result via --model local:. |
| `serve` | Live loop dashboard — tails .probevane/events-*.jsonl and streams steps/gates/tokens/edits to the browser over SSE while the loop runs. |
| `improve` | Screenshot-driven visual improvement loop — capture a page, a vision model judges it against a goal and rewrites the target file until met (visual analogue of the test loop). |
| `enqueue` | Add one work item (op + dir + flags) to the supervisor queue (<state>/queue.jsonl). A daemon started with PROBEVANE_QUEUE=1 pulls it on its next tick and dispatches it — the autonomous work intake. |
| `scan` | Enqueue one work item per repo for the supervisor to dispatch — feed a repo-list or dirs into the dark-factory queue. The autonomous front door (pairs with a PROBEVANE_QUEUE=1 daemon). |
| `otel` | Export the cost ledger as OpenTelemetry data (dep-free OTLP/JSON: gen_ai.* spans — one per run — + metrics: token usage, runs, acceptance, cost by model) → write a file, POST to a collector (--endpoint / OTEL_EXPORTER_OTLP_ENDPOINT), or emit Prometheus text (--prometheus). $0, reads runs.jsonl. |
| `history` | Run history + cost ledger — total spend, how much the harness landed alone vs needed takeover vs needed hand-finishing, per-model/per-path breakdown. |
| `peek` | Terminal live view of the loop — same event stream as serve, compact table (step/tool/gate/tokens) in the console. |
| `revert` | Undo a run — restore the files a run edited to its pre-run checkpoint (or remove ones it created), from the diary record. Safety net for a crashed/bad run. |
| `impact` | Test-impact analysis — which specs are affected by the diff since <base> (transitive import graph); --run executes only those to speed CI. |
| `assert-score` | Assertion-quality grade (0–100) of a suite — flags weak assertions (toBeDefined/toBeTruthy, tautologies, snapshot-only, bare not.toThrow) that pass without testing behavior. Complements audit (assertion-free) + bench (mutation). |
| `simcost` | Simulated cost benchmark — triage a dir into easy/hard modules and compare all-api vs hybrid (local easy + api hard) vs bridge cost, grounded in measured per-module $ from the ledger. |
| `factory` | Run the gated generate loop over many repos concurrently — each with isolated state, errored repos auto-reverted + retried once — into one cost/coverage/quality rollup (report.json, with an error-mode breakdown). --resume skips repos already accepted in a prior report. Unrecognized flags forward to generate per-repo. |
| `quality` | Project source-quality gate — file size, function length/cyclomatic+cognitive complexity/nesting/params, long lines, debt markers (TODO/FIXME, comment-scoped), import fan-out, and (maximal-block) duplication → a 0–100 health grade. --strict exits 1 on error-severity violations (CI). Complements audit (test specs), assert-score (assertions), bench (mutation). |
| `mfe-audit` | Micro-frontend (Module Federation) standards gate — per repo: boundaries (no deep cross-remote imports), shared singletons, runtime resilience (Suspense + error boundary), typed contracts; across repos: shared version alignment. Pure analysis ($0, no LLM) → grade + violations; --strict exits 1 (CI). The fitness function the refactor loop enforces. |
| `mfe-contract` | Generate Module Federation contract tests (deterministic, $0) — remote-side compile-time conformance (exposed module satisfies its published contract) + host-side mocked tests (consume each federated remote against its contract). Auto-detects the type source (*-contracts pkg / sibling .contract.ts / @mf-types) and falls back to a structural smoke with a publish-types note. Dry-run by default; --write emits. |
| `mfe` | Drive the micro-frontend (Module Federation) refactor pipeline over a polyrepo fleet — per repo: audit → (contract tests) → (generate) → (fix standards via refactor --mfe --quality), then cross-repo shared-version alignment + a combined report. Default (no LLM flags) = a $0 fleet standards report; --contract adds deterministic contract tests; --generate/--fix run the loop. |
| `daemon` | Long-running OPERATE/OBSERVE + control-center service — an HTML dashboard (/) plus /health, /aggregate (cost+acceptance over time), /alerts (cost spike / acceptance drop / error burst), /audit (library-mutation trail), /jobs, /queue, /metrics (Prometheus scrape), /otel/{traces,metrics} (OTLP JSON), and POST /run (launch an op) + /enqueue + /cancel?id=. With PROBEVANE_QUEUE=1 it becomes a SUPERVISOR — pulls <state>/queue.jsonl on a tick and dispatches runs (+ships on accept with PROBEVANE_SHIP=1), lights-out. Launched jobs persist to jobs.jsonl (restart-safe); structured log rotates; periodic alert re-eval + optional webhook. Binds 127.0.0.1; read-only over ledgers. |
| `ado` | Azure DevOps board integration — `ado run` polls the board for tagged work items, runs the loop per item, and reports progress back as state moves + comments; `ado create` files a task. Auth via AZURE_DEVOPS_PAT. |
| `docs` | Stack-agnostic narrative documentation loop — grounds a model on a language-agnostic project digest and writes a comprehensive long-form Markdown guide, gated so it cites only real paths (anti-hallucination). Unlike `document` (JSDoc on source) and `spec` (TS-import structured dump), works on any language. |
| `pipeline` | Describe the loop pipeline a config assembles, WITHOUT running it — profile() is a pure (config) to Rune[] function, so the runes/hooks/phases are derivable. Prints a phase-grouped listing + Mermaid; powers the wiki "Loop pipeline" interactive demo. |

## Reference

### init
Detect the stack and install test deps + config.

```
probevane init <dir>
# e.g.
probevane init ./my-app
```

### plan
Read-only action plan ($0, no LLM) — untested targets + coverage gaps + source-quality errors + MFE standards errors → a prioritized generate/refactor/fix/mfe-fix to-do list. The map before pointing the loop at a repo.

```
probevane plan <dir> [--kind unit|e2e] [--json]
# e.g.
probevane plan ./app
```

### generate
Probe-grounded gated loop writes unit/e2e tests (mock maker, hermetic, audited).

```
probevane generate <dir> [--kind unit|e2e] [--model auto|haiku|sonnet|opus|local:<id>] [--mock] [--mutation] [--flake-guard] [--target-gaps] [--a11y] [--visual] [--quality] [--assert-min N] [--flake-tolerance K] [--passk N] [--budget N] [--only <substr>] [--spec] [--ship]
# e.g.
probevane generate ./my-app --kind unit --mock
```

### refactor
Characterization-first refactor: change source only, every test stays green (behavior_lock). --quality adds a source-quality gate (edited files mustn't regress).

```
probevane refactor <dir> --task "<what to refactor>" [--only <path>] [--model …] [--budget N] [--force-stop-after N] [--quality] [--mfe] [--worktree [--worktree-merge]]
# e.g.
probevane refactor ./app --task "extract helpers into utils.ts" --quality
```

### feature
TDD red-first: write a failing test, implement, go green; existing tests protected. --quality gates edited-source quality.

```
probevane feature <dir> --task "<feature>" [--only <path>] [--model …] [--force-stop-after N] [--quality] [--mfe] [--worktree [--worktree-merge]]
# e.g.
probevane feature ./app --task "add a discount field to cartTotal"
```

### repair
After source changes, update the affected (stale) tests so the whole suite is green. --quality gates edited-source quality.

```
probevane repair <dir> [--since <ref>] [--only <path>] [--model …] [--force-stop-after N] [--quality] [--mfe] [--worktree [--worktree-merge]]
# e.g.
probevane repair ./app --since HEAD~1
```

### fix
Apply described issues/findings to the code, keeping the suite green + audit-clean. --quality gates edited-source quality.

```
probevane fix <dir> --task "<issues>" [--only <path>] [--model …] [--force-stop-after N] [--quality] [--mfe] [--worktree [--worktree-merge]]
# e.g.
probevane fix ./app --task "handle the null case in parse()"
```

### migrate
Codemod / framework-version migration: change source to the new API/version while every existing test stays green (behavior_lock). --quality/--mfe gates optional; run repair after if expectations legitimately change.

```
probevane migrate <dir> --task "<migration>" | --to <pkg@version> [--only <path>] [--model …] [--quality] [--mfe] [--force-stop-after N]
# e.g.
probevane migrate ./app --to react@19
```

### document
Add documentation only — JSDoc/TSDoc on exported APIs + comments on non-obvious logic; no behavior change (tests + typecheck stay green). --only focuses one area.

```
probevane document <dir> [--only <path>] [--task "<focus>"] [--model …] [--force-stop-after N] [--worktree [--worktree-merge]]
# e.g.
probevane document ./app --only src/api.ts
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

### improve-cycle
Close the self-improvement loop — promote a model as the loop default (writes <state>/model.json, which generate reads when no --model/config given), or --compare two eval results and promote the better (higher acceptance, then lower cost). LoRA training stays distill train --execute; this auto-measures/auto-promotes.

```
probevane improve-cycle [--promote <model>] [--compare <a.json> <b.json>] [--status]
# e.g.
probevane improve-cycle --status
```

### distill
Build a fine-tuning dataset from accepted-test traces (PROBEVANE_TRACES=1) and print the LoRA training plan; serve the result via --model local:.

```
probevane distill <build|stats|train|bases> [--execute] [--models a,b]
# e.g.
probevane distill build
```

### serve
Live loop dashboard — tails .probevane/events-*.jsonl and streams steps/gates/tokens/edits to the browser over SSE while the loop runs.

```
probevane serve [dir] [--port N]
# e.g.
probevane serve ./app
```

### improve
Screenshot-driven visual improvement loop — capture a page, a vision model judges it against a goal and rewrites the target file until met (visual analogue of the test loop).

```
probevane improve --url <u> --target <file> --goal "<g>" [--selector <css>] [--reload <cmd>] [--max N]
# e.g.
probevane improve --url http://localhost:4173/x --target src/ui/loop.html --goal "make the header prominent"
```

### enqueue
Add one work item (op + dir + flags) to the supervisor queue (<state>/queue.jsonl). A daemon started with PROBEVANE_QUEUE=1 pulls it on its next tick and dispatches it — the autonomous work intake.

```
probevane enqueue <op> <dir> [--root <stateDir>] [...op flags]
# e.g.
probevane enqueue generate ./app --kind unit
```

### scan
Enqueue one work item per repo for the supervisor to dispatch — feed a repo-list or dirs into the dark-factory queue. The autonomous front door (pairs with a PROBEVANE_QUEUE=1 daemon).

```
probevane scan <repos.txt | dir...> [--op generate] [--root <stateDir>]
# e.g.
probevane scan repos.txt --op generate
```

### otel
Export the cost ledger as OpenTelemetry data (dep-free OTLP/JSON: gen_ai.* spans — one per run — + metrics: token usage, runs, acceptance, cost by model) → write a file, POST to a collector (--endpoint / OTEL_EXPORTER_OTLP_ENDPOINT), or emit Prometheus text (--prometheus). $0, reads runs.jsonl.

```
probevane otel [--root <stateDir>] [--out <file>] [--endpoint <url>] [--prometheus]
# e.g.
probevane otel --prometheus
```

### history
Run history + cost ledger — total spend, how much the harness landed alone vs needed takeover vs needed hand-finishing, per-model/per-path breakdown.

```
probevane history [--limit N] [--json]
# e.g.
probevane history
```

### peek
Terminal live view of the loop — same event stream as serve, compact table (step/tool/gate/tokens) in the console.

```
probevane peek [dir]
# e.g.
probevane peek ./app
```

### revert
Undo a run — restore the files a run edited to its pre-run checkpoint (or remove ones it created), from the diary record. Safety net for a crashed/bad run.

```
probevane revert <runId> [dir]
# e.g.
probevane revert run-abc123 ./app
```

### impact
Test-impact analysis — which specs are affected by the diff since <base> (transitive import graph); --run executes only those to speed CI.

```
probevane impact <dir> [--base <ref>] [--run] [--json]
# e.g.
probevane impact . --base origin/main --run
```

### assert-score
Assertion-quality grade (0–100) of a suite — flags weak assertions (toBeDefined/toBeTruthy, tautologies, snapshot-only, bare not.toThrow) that pass without testing behavior. Complements audit (assertion-free) + bench (mutation).

```
probevane assert-score <dir> [--json]
# e.g.
probevane assert-score ./app
```

### simcost
Simulated cost benchmark — triage a dir into easy/hard modules and compare all-api vs hybrid (local easy + api hard) vs bridge cost, grounded in measured per-module $ from the ledger.

```
probevane simcost [dir] [--easy N --hard M] [--local-hit R] [--json]
# e.g.
probevane simcost ./app --local-hit 0.6
```

### factory
Run the gated generate loop over many repos concurrently — each with isolated state, errored repos auto-reverted + retried once — into one cost/coverage/quality rollup (report.json, with an error-mode breakdown). --resume skips repos already accepted in a prior report. Unrecognized flags forward to generate per-repo.

```
probevane factory <repos.txt | dir...> [--concurrency N] [--kind unit|e2e] [--report <path>] [--state-root <dir>] [--resume] [--no-retry] [--no-checkpoint] [--ship] [--emit-matrix [--out <file>]] [...generate flags]
# e.g.
probevane factory repos.txt --concurrency 4 --model auto
```

### quality
Project source-quality gate — file size, function length/cyclomatic+cognitive complexity/nesting/params, long lines, debt markers (TODO/FIXME, comment-scoped), import fan-out, and (maximal-block) duplication → a 0–100 health grade. --strict exits 1 on error-severity violations (CI). Complements audit (test specs), assert-score (assertions), bench (mutation).

```
probevane quality <dir> [--strict] [--json] [--max-file N] [--max-fn N] [--max-complexity N] [--max-cognitive N] [--max-nesting N] [--max-params N] [--max-width N] [--max-imports N] [--no-debt]
# e.g.
probevane quality ./app --strict
```

### mfe-audit
Micro-frontend (Module Federation) standards gate — per repo: boundaries (no deep cross-remote imports), shared singletons, runtime resilience (Suspense + error boundary), typed contracts; across repos: shared version alignment. Pure analysis ($0, no LLM) → grade + violations; --strict exits 1 (CI). The fitness function the refactor loop enforces.

```
probevane mfe-audit <dir | repos.txt> [--repos <file>] [--json] [--strict] [--design-system <pkg>]
# e.g.
probevane mfe-audit ./host --strict
```

### mfe-contract
Generate Module Federation contract tests (deterministic, $0) — remote-side compile-time conformance (exposed module satisfies its published contract) + host-side mocked tests (consume each federated remote against its contract). Auto-detects the type source (*-contracts pkg / sibling .contract.ts / @mf-types) and falls back to a structural smoke with a publish-types note. Dry-run by default; --write emits.

```
probevane mfe-contract <dir> [--write] [--json]
# e.g.
probevane mfe-contract ./cart --write
```

### mfe
Drive the micro-frontend (Module Federation) refactor pipeline over a polyrepo fleet — per repo: audit → (contract tests) → (generate) → (fix standards via refactor --mfe --quality), then cross-repo shared-version alignment + a combined report. Default (no LLM flags) = a $0 fleet standards report; --contract adds deterministic contract tests; --generate/--fix run the loop.

```
probevane mfe <repos.txt | dir...> [--contract] [--generate] [--fix] [--model …] [--concurrency N] [--report <path>] [--strict] [--json]
# e.g.
probevane mfe repos.txt --contract
```

### daemon
Long-running OPERATE/OBSERVE + control-center service — an HTML dashboard (/) plus /health, /aggregate (cost+acceptance over time), /alerts (cost spike / acceptance drop / error burst), /audit (library-mutation trail), /jobs, /queue, /metrics (Prometheus scrape), /otel/{traces,metrics} (OTLP JSON), and POST /run (launch an op) + /enqueue + /cancel?id=. With PROBEVANE_QUEUE=1 it becomes a SUPERVISOR — pulls <state>/queue.jsonl on a tick and dispatches runs (+ships on accept with PROBEVANE_SHIP=1), lights-out. Launched jobs persist to jobs.jsonl (restart-safe); structured log rotates; periodic alert re-eval + optional webhook. Binds 127.0.0.1; read-only over ledgers.

```
probevane daemon [--port N] [--root <stateDir>] [--interval SEC]
# e.g.
probevane daemon --port 7766
```

### ado
Azure DevOps board integration — `ado run` polls the board for tagged work items, runs the loop per item, and reports progress back as state moves + comments; `ado create` files a task. Auth via AZURE_DEVOPS_PAT.

```
probevane ado <run|create> [--project P] [--org O] [--tag probevane] [--title "<t>"] [--type Issue]
# e.g.
probevane ado run --project probevane
```

### docs
Stack-agnostic narrative documentation loop — grounds a model on a language-agnostic project digest and writes a comprehensive long-form Markdown guide, gated so it cites only real paths (anti-hallucination). Unlike `document` (JSDoc on source) and `spec` (TS-import structured dump), works on any language.

```
probevane docs <dir> [--out <path>] [--sections a,b,c] [--model …] [--max-steps N] [--budget N]
# e.g.
probevane docs ./app --model bridge
```

### pipeline
Describe the loop pipeline a config assembles, WITHOUT running it — profile() is a pure (config) to Rune[] function, so the runes/hooks/phases are derivable. Prints a phase-grouped listing + Mermaid; powers the wiki "Loop pipeline" interactive demo.

```
probevane pipeline [--profile feature] [--kind unit|e2e] [--quality --mutation --flake --a11y --visual --mfe --min-tests N --min-coverage P] [--json | --mermaid <out> | --emit-model <file>]
# e.g.
probevane pipeline --profile feature --quality --json
```

## Safety + cost

- All loop commands are **gated**: they cannot finish red, audit-broken, non-hermetic, or below coverage. Issue-discovery (`review`) is itself gated — findings are grounded + adversarially verified before any auto-fix.
- `--budget N` caps output tokens (a stuck loop stops). `--model auto` routes complex code to a stronger model up front (cheaper than churning a weak one).
- Runs never edit `node_modules`/build/lockfiles (path_guard) and never weaken existing tests.
