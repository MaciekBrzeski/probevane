# Commands

_Generated from `src/skill/catalog.ts` by `probevane skill` — do not edit by hand. CI gates drift._

The CLI is `./bin/probevane <command> <dir> [flags]`. Loop commands need `ANTHROPIC_API_KEY` (or `--model local:<id>`). See [CLI](CLI.md) for the narrative intro and [Paths](Paths.md) for the task paths.

| command | what it does |
|---|---|
| `init` | Detect the stack and install test deps + config. |
| `plan` | Read-only action plan ($0, no LLM) — untested targets + coverage gaps + source-quality errors + MFE standards errors → a prioritized generate/refactor/fix/mfe-fix to-do list. The map before pointing the loop at a repo. |
| `plan-feature` | Feature planner — a LOCAL model fills in the middle: give it the CURRENT state and DESIRED state and it writes the detailed, ordered steps between them. Fill-in-the-middle (prefix=current, suffix=desired) when the model supports it, chat framing otherwise. |
| `generate` | Probe-grounded gated loop writes unit/e2e tests (mock maker, hermetic, audited). |
| `refactor` | Characterization-first refactor: change source only, every test stays green (behavior_lock). --quality adds a source-quality gate (edited files mustn't regress). |
| `feature` | TDD red-first: write a failing test, implement, go green; existing tests protected. --quality gates edited-source quality. |
| `repair` | After source changes, update the affected (stale) tests so the whole suite is green. --quality gates edited-source quality. |
| `fix` | Apply described issues/findings to the code, keeping the suite green + audit-clean. --quality gates edited-source quality. |
| `migrate` | Codemod / framework-version migration: change source to the new API/version while every existing test stays green (behavior_lock). --quality/--mfe gates optional; run repair after if expectations legitimately change. |
| `document` | Add documentation only — JSDoc/TSDoc on exported APIs + comments on non-obvious logic; no behavior change (tests + typecheck stay green). --only focuses one area. |
| `visual` | The VISUAL/graphics path: edit render/shader/material/geometry source to hit a visual goal. The existing test suite stays green (behavior_lock); the acceptance oracle is render_gate, NOT a test count — a running app is screenshotted and a vision model judges whether it renders cleanly AND matches the goal (+ optional perf budget), feeding its critique back into the loop until it passes. Start the dev server first and pass its URL. $0 vision via PROBEVANE_VISION_BASE (ollama) or claude with credits. |
| `review` | Read-only quality grade (0–100) of a suite: green, coverage, audit, flake. |
| `a11y` | Static accessibility audit of components (missing alt/name/label, click-no-role, positive tabindex) → grade. |
| `bench` | Measure a suite: coverage, audit, and mutation score (does it catch bugs?). |
| `mutation` | Full per-site mutation test — flips operators (===/!==/>=/<=/&&/true/+) one at a time, reruns the suite, reports killed vs SURVIVED (mutants the tests miss = coverage that does not catch bugs) with per-file scores + the exact surviving sites. --min-score P exits 1 below (CI gate); --budget caps mutants (sampled evenly); string/comment literals skipped. |
| `ci` | PR helper: report changed-untested files + coverage; --generate adds tests; --review-fix reviews the diff (gated) and auto-fixes. |
| `mock` | Synthesize the mock boundary (MSW handlers, fixtures, contracts) from the module graph. |
| `graph` | Render the module dependency graph (ASCII tree + Mermaid). |
| `search` | Semantic code search — embeds each module (path + probe digest) and ranks by cosine similarity to a CONCEPT query; --similar finds semantically-duplicate module PAIRS (consolidation candidates the textual duplication detector misses). Embeds via local ollama by default ($0); PROBEVANE_EMBED_URL/_MODEL override. Index cached at .probevane/search-index.json. |
| `spec` | Generate a project SPEC.md (graph, modules, API surface, coverage); --narrate adds LLM descriptions; --wiki publishes. |
| `run` | Execute the test suite via the detected adapter. |
| `coverage` | Report coverage via the adapter. |
| `audit` | Static quality gate over the spec files (exit 1 on errors). |
| `status` | Quick dashboard: adapter, suite result, coverage. |
| `learn` | Save a spec to the cross-project learning library. |
| `eval` | Run probevane's fixture eval (self-test of the harness); --live regenerates; --paths replays the refactor/feature/repair cassettes (--record --model bridge re-records for $0). |
| `watch` | Watch src/ and on each save map the file → repair (has a test) or generate (none); --run triggers the loop. |
| `skill` | Generate/check the probevane control skill (this doc). --check fails on drift. |
| `improve-cycle` | Close the self-improvement loop — promote a model as the loop default (writes <state>/model.json, which generate reads when no --model/config given), or --compare two eval results and promote the better (higher acceptance, then lower cost). LoRA training stays distill train --execute; this auto-measures/auto-promotes. |
| `distill` | Build a fine-tuning dataset from accepted-test traces (PROBEVANE_TRACES=1) and print the LoRA training plan; serve the result via --model local:. |
| `serve` | Live loop dashboard — tails .probevane/events-*.jsonl and streams steps/gates/tokens/edits to the browser over SSE while the loop runs. |
| `improve` | Screenshot-driven visual improvement loop — capture a page, a vision model judges it against a goal and rewrites the target file until met (visual analogue of the test loop). |
| `arch` | Experimental architecture critique — render the on-disk folder tree + module dependency tree + directory coupling metrics (fan-in/out, heaviest cross-dir edges, dir cycles, shared hubs), then an LLM ($0 ollama) surfaces concrete structural improvements (misplaced modules, over-coupled/splittable dirs, layering issues). Report-only, never edits. --snapshot persists the coupling metrics (docs/arch-snapshot.json) and prints drift vs the previous snapshot — commit it to make coupling regressions visible over time. --pyramid scores the tree against the pyramid structure model (isolated feature pyramids on a glue base, shared dirs as the common floor): dir roles inferred from coupling, declared durably in probevane.config (arch: { glue, shared, feature }) or per-run via --glue/--shared/--feature (flag > config > heuristic); flags feature→feature, feature→glue, shared→feature and glue deep-reach imports with per-violation fix cost, 0-100 score. |
| `visual` | The VISUAL task path — edit render/shader/material source to hit a visual goal. Acceptance oracle is render_gate, not test counts: screenshot the running app, a vision model judges it renders cleanly and matches the goal (adversarial majority via --vision-votes, optional perf budget via --perf-cmd), critique fed back into the loop until PASS; behavior_lock keeps the existing suite green. Start the dev server first and pass its URL. $0 vision via PROBEVANE_VISION_BASE (ollama) or claude with credits. |
| `plan-feature` | Feature planner — give it the CURRENT state and the DESIRED state and a LOCAL model fills in the middle: the detailed, ordered steps between them. Literal fill-in-the-middle (prefix=current, suffix=desired) when the model supports FIM, chat framing otherwise (--mode auto|fim|chat). Default model from PROBEVANE_PLAN_MODEL (local:mk-coder:lora-v8). |
| `design` | Combined design loop — write a Playwright spec that screenshots each page/tab, a vision model judges each shot for design practice, then rewrite the target html's <style> to address findings, and repeat. Leaves the spec as a visual-regression test. $0 vision via PROBEVANE_VISION_BASE (ollama cloud minimax-m3). |
| `enqueue` | Add one work item (op + dir + flags) to the supervisor queue (<state>/queue.jsonl). A daemon started with PROBEVANE_QUEUE=1 pulls it on its next tick and dispatches it — the autonomous work intake. |
| `scan` | Enqueue one work item per repo for the supervisor to dispatch — feed a repo-list or dirs into the dark-factory queue. The autonomous front door (pairs with a PROBEVANE_QUEUE=1 daemon). |
| `otel` | Export the cost ledger as OpenTelemetry data (dep-free OTLP/JSON: gen_ai.* spans — one per run — + metrics: token usage, runs, acceptance, cost by model) → write a file, POST to a collector (--endpoint / OTEL_EXPORTER_OTLP_ENDPOINT), or emit Prometheus text (--prometheus). $0, reads runs.jsonl. |
| `doctor` | Health checks distilled from real field failures — detect (and with --fix repair) broken toolchains (bootstraps e.g. a python .venv), coverage blind spots (source never loaded by any test, respecting deliberate config excludes), git-tracked test artifacts (untrack + gitignore), package.json "files" entries that don't exist, CI steps swallowing failures (|| true), and stale replay cassettes; also missing node_modules/Playwright browsers, invalid probevane.config, absent live credentials, eval case↔fixture↔baseline bijection, and stale coverage reports. --full appends a read-only grader scorecard (audit/assertions/coverage/quality/arch). Exit 1 on unfixed errors. |
| `history` | Run history + cost ledger — total spend, how much the harness landed alone vs needed takeover vs needed hand-finishing, per-model/per-path breakdown; --trend adds the daily time-series + the daemon’s cost/acceptance alerts. |
| `peek` | Terminal live view of the loop — same event stream as serve, compact table (step/tool/gate/tokens) in the console. |
| `revert` | Undo a run — restore the files a run edited to its pre-run checkpoint (or remove ones it created), from the diary record. Safety net for a crashed/bad run. |
| `impact` | Test-impact analysis — which specs are affected by the diff since <base> (transitive import graph); --run executes only those to speed CI. |
| `assert-score` | Assertion-quality grade (0–100) of a suite — flags weak assertions (toBeDefined/toBeTruthy, tautologies, snapshot-only, bare not.toThrow) that pass without testing behavior. Complements audit (assertion-free) + bench (mutation). |
| `simcost` | Simulated cost benchmark — triage a dir into easy/hard modules and compare all-api vs hybrid (local easy + api hard) vs bridge cost, grounded in measured per-module $ from the ledger. |
| `factory` | Run the gated generate loop over many repos concurrently — each with isolated state, errored repos auto-reverted + retried once — into one cost/coverage/quality rollup (report.json, with an error-mode breakdown). --resume skips repos already accepted in a prior report. Unrecognized flags forward to generate per-repo. |
| `quality` | Project source-quality gate — file size, function length/cyclomatic+cognitive complexity/nesting/params, long lines, debt markers (TODO/FIXME, comment-scoped), import fan-out, and (maximal-block) duplication → a 0–100 health grade. --strict exits 1 on error-severity violations (CI); --sarif emits GitHub code-scanning output; --write-baseline ratchets (gate only NEW violations on a messy repo, --no-baseline ignores it); --since <ref> scans only changed files. Complements audit (test specs), assert-score (assertions), bench (mutation). |
| `mfe-audit` | Micro-frontend (Module Federation) standards gate — per repo: boundaries (no deep cross-remote imports), shared singletons, runtime resilience (Suspense + error boundary), typed contracts; across repos: shared version alignment. Pure analysis ($0, no LLM) → grade + violations; --strict exits 1 (CI). The fitness function the refactor loop enforces. |
| `mfe-contract` | Generate Module Federation contract tests (deterministic, $0) — remote-side compile-time conformance (exposed module satisfies its published contract) + host-side mocked tests (consume each federated remote against its contract). Auto-detects the type source (*-contracts pkg / sibling .contract.ts / @mf-types) and falls back to a structural smoke with a publish-types note. Dry-run by default; --write emits. |
| `mfe` | Drive the micro-frontend (Module Federation) refactor pipeline over a polyrepo fleet — per repo: audit → (contract tests) → (generate) → (fix standards via refactor --mfe --quality), then cross-repo shared-version alignment + a combined report. Default (no LLM flags) = a $0 fleet standards report; --contract adds deterministic contract tests; --generate/--fix run the loop. |
| `tui` | The control center IN THE TERMINAL. Auto-launches the daemon (if not already up), then renders panes — cost sparkline, rune-pipeline light show, active jobs, alerts — on a diff-flushed screen (no flicker). Keys: q quit · r refresh · s drop to a shell (run generate/claude, then come back) · ↑↓ select a run · enter to replay its light show. $0 (pure client of the daemon; Ctrl-C restores the terminal). |
| `daemon` | Long-running OPERATE/OBSERVE + control-center service — the LCARS control center (/) — Projects/Runs/Docs/Launch/Cost/Quality/Console tabs; the Console renders the rune pipeline as a live node graph (gate blocks flash red during watched runs, accept cascades green), telemetry gauges/sparks, the module constellation, and THEATER replay of any captured run’s light show (no loop, ␤0). Routes: /health, /aggregate, /alerts, /audit, /jobs, /queue, /metrics (Prometheus), /otel/{traces,metrics}, /pipeline, /graph, /events?runId (theater), POST /run + /enqueue + /cancel?id=. PROBEVANE_UI_DEV=1 recompiles the TSX sources per request (edit → refresh); PROBEVANE_TERMINAL=1 arms a Terminal tab — a live browser shell over a PTY (run claude/any CLI in-console) via /term/{start,stream,input,resize,kill,sessions} (opt-in; it bypasses the launch allowlist, loopback bind is the only auth). With PROBEVANE_QUEUE=1 it becomes a SUPERVISOR — pulls <state>/queue.jsonl on a tick and dispatches runs (+ships on accept with PROBEVANE_SHIP=1), lights-out. Launched jobs persist to jobs.jsonl (restart-safe); structured log rotates; periodic alert re-eval + optional webhook. Binds 127.0.0.1; read-only over ledgers. |
| `ado` | Azure DevOps board integration — `ado run` polls the board for tagged work items, runs the loop per item, and reports progress back as state moves + comments; `ado create` files a task. Auth via AZURE_DEVOPS_PAT. |
| `docs` | Stack-agnostic narrative documentation loop — grounds a model on a language-agnostic project digest and writes a comprehensive long-form Markdown guide, gated so it cites only real paths (anti-hallucination). Unlike `document` (JSDoc on source) and `spec` (TS-import structured dump), works on any language. |
| `pipeline` | Describe the loop pipeline a config assembles, WITHOUT running it — profile() is a pure (config) to Rune[] function, so the runes/hooks/phases are derivable. Prints a phase-grouped listing + Mermaid; powers the wiki "Loop pipeline" interactive demo. |
| `intake` | Turn a simple NL prompt into a frozen, machine-checkable RunSpec ($0, no LLM required): classify the task path, ask the few clarifying questions (interactive TTY) or read a policy file (--answers), and persist <state>/specs/<id>.json — the specification a dark run executes. One spec object, two fill-modes. |
| `factory-dark` | The dark factory: prompt → RunSpec (intake) → per-file decomposition (buildPlan) → enqueue each single-file unit onto the supervisor queue. A daemon with PROBEVANE_QUEUE=1 runs them unattended, ships accepted units, and PARKS deterministic give-ups (difficulty/max_steps/stuck) with the stop reason instead of blind-retrying. --dry-run previews units; --report <batchId> rolls the ledger up per unit (accepted/parked/pending). |

## Reference

### init
Detect the stack and install test deps + config.

```bash
probevane init <dir>
# e.g. probevane init ./my-app
```

### plan
Read-only action plan ($0, no LLM) — untested targets + coverage gaps + source-quality errors + MFE standards errors → a prioritized generate/refactor/fix/mfe-fix to-do list. The map before pointing the loop at a repo.

```bash
probevane plan <dir> [--kind unit|e2e] [--json]
# e.g. probevane plan ./app
```

### plan-feature
Feature planner — a LOCAL model fills in the middle: give it the CURRENT state and DESIRED state and it writes the detailed, ordered steps between them. Fill-in-the-middle (prefix=current, suffix=desired) when the model supports it, chat framing otherwise.

```bash
probevane plan-feature --from "<current>" --to "<desired>" [--from-file f] [--to-file f] [--model local:<id>|ollama:<id>] [--mode auto|fim|chat] [--steps N] [--json] [--out file]
# e.g. probevane plan-feature --from "empty repo" --to "REST API with auth"
```

### generate
Probe-grounded gated loop writes unit/e2e tests (mock maker, hermetic, audited).

```bash
probevane generate <dir> [--kind unit|e2e] [--model auto|haiku|sonnet|opus|local:<id>] [--mock] [--mutation] [--flake-guard] [--target-gaps] [--a11y] [--visual] [--quality] [--assert-min N] [--flake-tolerance K] [--passk N] [--budget N] [--only <substr>] [--spec] [--ship]
# e.g. probevane generate ./my-app --kind unit --mock
```

### refactor
Characterization-first refactor: change source only, every test stays green (behavior_lock). --quality adds a source-quality gate (edited files mustn't regress).

```bash
probevane refactor <dir> --task "<what to refactor>" [--only <path>] [--model …] [--budget N] [--force-stop-after N] [--quality] [--mfe] [--worktree [--worktree-merge|--worktree-review]]
# e.g. probevane refactor ./app --task "extract helpers into utils.ts" --quality
```

### feature
TDD red-first: write a failing test, implement, go green; existing tests protected. --quality gates edited-source quality.

```bash
probevane feature <dir> --task "<feature>" [--only <path>] [--model …] [--force-stop-after N] [--quality] [--mfe] [--worktree [--worktree-merge|--worktree-review]]
# e.g. probevane feature ./app --task "add a discount field to cartTotal"
```

### repair
After source changes, update the affected (stale) tests so the whole suite is green. --quality gates edited-source quality.

```bash
probevane repair <dir> [--since <ref>] [--only <path>] [--model …] [--force-stop-after N] [--quality] [--mfe] [--worktree [--worktree-merge|--worktree-review]]
# e.g. probevane repair ./app --since HEAD~1
```

### fix
Apply described issues/findings to the code, keeping the suite green + audit-clean. --quality gates edited-source quality.

```bash
probevane fix <dir> --task "<issues>" [--only <path>] [--model …] [--force-stop-after N] [--quality] [--mfe] [--worktree [--worktree-merge|--worktree-review]]
# e.g. probevane fix ./app --task "handle the null case in parse()"
```

### migrate
Codemod / framework-version migration: change source to the new API/version while every existing test stays green (behavior_lock). --quality/--mfe gates optional; run repair after if expectations legitimately change.

```bash
probevane migrate <dir> --task "<migration>" | --to <pkg@version> [--only <path>] [--model …] [--quality] [--mfe] [--force-stop-after N] [--worktree [--worktree-merge|--worktree-review]]
# e.g. probevane migrate ./app --to react@19
```

### document
Add documentation only — JSDoc/TSDoc on exported APIs + comments on non-obvious logic; no behavior change (tests + typecheck stay green). --only focuses one area.

```bash
probevane document <dir> [--only <path>] [--task "<focus>"] [--model …] [--force-stop-after N] [--worktree [--worktree-merge|--worktree-review]]
# e.g. probevane document ./app --only src/api.ts
```

### visual
The VISUAL/graphics path: edit render/shader/material/geometry source to hit a visual goal. The existing test suite stays green (behavior_lock); the acceptance oracle is render_gate, NOT a test count — a running app is screenshotted and a vision model judges whether it renders cleanly AND matches the goal (+ optional perf budget), feeding its critique back into the loop until it passes. Start the dev server first and pass its URL. $0 vision via PROBEVANE_VISION_BASE (ollama) or claude with credits.

```bash
probevane visual <dir> --url <running-app-url> --goal "<what to achieve>" [--reload "<cmd>"] [--perf-cmd "<cmd>"] [--selector <css>] [--vision-votes N] [--task "<hint>"] [--model …] [--only <path>] [--budget N]
# e.g. probevane visual packages/render --url http://localhost:5173 --goal "creatures have visibly dense fur"
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

### mutation
Full per-site mutation test — flips operators (===/!==/>=/<=/&&/true/+) one at a time, reruns the suite, reports killed vs SURVIVED (mutants the tests miss = coverage that does not catch bugs) with per-file scores + the exact surviving sites. --min-score P exits 1 below (CI gate); --budget caps mutants (sampled evenly); string/comment literals skipped.

```bash
probevane mutation <dir> [--budget N] [--only a,b] [--min-score P] [--all] [--json]
# e.g. probevane mutation . --budget 60 --min-score 0.6
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

### search
Semantic code search — embeds each module (path + probe digest) and ranks by cosine similarity to a CONCEPT query; --similar finds semantically-duplicate module PAIRS (consolidation candidates the textual duplication detector misses). Embeds via local ollama by default ($0); PROBEVANE_EMBED_URL/_MODEL override. Index cached at .probevane/search-index.json.

```bash
probevane search <dir> "<concept>" [--top N] [--fresh] | probevane search <dir> --similar [--threshold 0.85] [--top N]
# e.g. probevane search . "retry with backoff"
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
Run probevane's fixture eval (self-test of the harness); --live regenerates; --paths replays the refactor/feature/repair cassettes (--record --model bridge re-records for $0).

```bash
probevane eval [--live] [--flake N] [--paths [--record] [--model <m>]]
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

### improve-cycle
Close the self-improvement loop — promote a model as the loop default (writes <state>/model.json, which generate reads when no --model/config given), or --compare two eval results and promote the better (higher acceptance, then lower cost). LoRA training stays distill train --execute; this auto-measures/auto-promotes.

```bash
probevane improve-cycle [--promote <model>] [--compare <a.json> <b.json>] [--status]
# e.g. probevane improve-cycle --status
```

### distill
Build a fine-tuning dataset from accepted-test traces (PROBEVANE_TRACES=1) and print the LoRA training plan; serve the result via --model local:.

```bash
probevane distill <build|stats|train|bases> [--execute] [--models a,b]
# e.g. probevane distill build
```

### serve
Live loop dashboard — tails .probevane/events-*.jsonl and streams steps/gates/tokens/edits to the browser over SSE while the loop runs.

```bash
probevane serve [dir] [--port N]
# e.g. probevane serve ./app
```

### improve
Screenshot-driven visual improvement loop — capture a page, a vision model judges it against a goal and rewrites the target file until met (visual analogue of the test loop).

```bash
probevane improve --url <u> --target <file> --goal "<g>" [--selector <css>] [--reload <cmd>] [--max N]
# e.g. probevane improve --url http://localhost:4173/x --target src/ui/loop.html --goal "make the header prominent"
```

### arch
Experimental architecture critique — render the on-disk folder tree + module dependency tree + directory coupling metrics (fan-in/out, heaviest cross-dir edges, dir cycles, shared hubs), then an LLM ($0 ollama) surfaces concrete structural improvements (misplaced modules, over-coupled/splittable dirs, layering issues). Report-only, never edits. --snapshot persists the coupling metrics (docs/arch-snapshot.json) and prints drift vs the previous snapshot — commit it to make coupling regressions visible over time. --pyramid scores the tree against the pyramid structure model (isolated feature pyramids on a glue base, shared dirs as the common floor): dir roles inferred from coupling, declared durably in probevane.config (arch: { glue, shared, feature }) or per-run via --glue/--shared/--feature (flag > config > heuristic); flags feature→feature, feature→glue, shared→feature and glue deep-reach imports with per-violation fix cost, 0-100 score.

```bash
probevane arch <dir> [--no-llm] [--folder-only] [--pyramid [--glue a,b] [--shared c,d] [--feature e,f]] [--snapshot [--out <file>]]
# e.g. probevane arch . --pyramid
```

### visual
The VISUAL task path — edit render/shader/material source to hit a visual goal. Acceptance oracle is render_gate, not test counts: screenshot the running app, a vision model judges it renders cleanly and matches the goal (adversarial majority via --vision-votes, optional perf budget via --perf-cmd), critique fed back into the loop until PASS; behavior_lock keeps the existing suite green. Start the dev server first and pass its URL. $0 vision via PROBEVANE_VISION_BASE (ollama) or claude with credits.

```bash
probevane visual <dir> --url <running-app-url> --goal "<what to achieve>" [--task "<hint>"] [--reload "<cmd>"] [--perf-cmd "<cmd>"] [--selector <css>] [--vision-votes N] [--settle <ms>] [--model …] [--budget N] [--only <path>]
# e.g. probevane visual ./app --url http://localhost:5173 --goal "water renders with animated waves, no z-fighting"
```

### plan-feature
Feature planner — give it the CURRENT state and the DESIRED state and a LOCAL model fills in the middle: the detailed, ordered steps between them. Literal fill-in-the-middle (prefix=current, suffix=desired) when the model supports FIM, chat framing otherwise (--mode auto|fim|chat). Default model from PROBEVANE_PLAN_MODEL (local:mk-coder:lora-v8).

```bash
probevane plan-feature --from "<current>" --to "<desired>" [--from-file f] [--to-file f] [--model local:<id>|ollama:<id>] [--mode auto|fim|chat] [--steps N] [--json] [--out f]
# e.g. probevane plan-feature --from "todo app, no persistence" --to "todos survive reload via localStorage"
```

### design
Combined design loop — write a Playwright spec that screenshots each page/tab, a vision model judges each shot for design practice, then rewrite the target html's <style> to address findings, and repeat. Leaves the spec as a visual-regression test. $0 vision via PROBEVANE_VISION_BASE (ollama cloud minimax-m3).

```bash
probevane design --url <u> --target <file> [--tabs a,b,c] [--goal "<g>"] [--rounds N] [--spec <file>]
# e.g. probevane design --url http://localhost:7766/ --target src/ui/control.html --tabs projects,runs,docs --spec e2e-dash/control-shots.spec.ts
```

### enqueue
Add one work item (op + dir + flags) to the supervisor queue (<state>/queue.jsonl). A daemon started with PROBEVANE_QUEUE=1 pulls it on its next tick and dispatches it — the autonomous work intake.

```bash
probevane enqueue <op> <dir> [--root <stateDir>] [...op flags]
# e.g. probevane enqueue generate ./app --kind unit
```

### scan
Enqueue one work item per repo for the supervisor to dispatch — feed a repo-list or dirs into the dark-factory queue. The autonomous front door (pairs with a PROBEVANE_QUEUE=1 daemon).

```bash
probevane scan <repos.txt | dir...> [--op generate] [--root <stateDir>]
# e.g. probevane scan repos.txt --op generate
```

### otel
Export the cost ledger as OpenTelemetry data (dep-free OTLP/JSON: gen_ai.* spans — one per run — + metrics: token usage, runs, acceptance, cost by model) → write a file, POST to a collector (--endpoint / OTEL_EXPORTER_OTLP_ENDPOINT), or emit Prometheus text (--prometheus). $0, reads runs.jsonl.

```bash
probevane otel [--root <stateDir>] [--out <file>] [--endpoint <url>] [--prometheus]
# e.g. probevane otel --prometheus
```

### doctor
Health checks distilled from real field failures — detect (and with --fix repair) broken toolchains (bootstraps e.g. a python .venv), coverage blind spots (source never loaded by any test, respecting deliberate config excludes), git-tracked test artifacts (untrack + gitignore), package.json "files" entries that don't exist, CI steps swallowing failures (|| true), and stale replay cassettes; also missing node_modules/Playwright browsers, invalid probevane.config, absent live credentials, eval case↔fixture↔baseline bijection, and stale coverage reports. --full appends a read-only grader scorecard (audit/assertions/coverage/quality/arch). Exit 1 on unfixed errors.

```bash
probevane doctor <dir> [--fix] [--full] [--json]
# e.g. probevane doctor . --fix
```

### history
Run history + cost ledger — total spend, how much the harness landed alone vs needed takeover vs needed hand-finishing, per-model/per-path breakdown; --trend adds the daily time-series + the daemon’s cost/acceptance alerts.

```bash
probevane history [--limit N] [--json] [--trend [--days N]]
# e.g. probevane history --trend
```

### peek
Terminal live view of the loop — same event stream as serve, compact table (step/tool/gate/tokens) in the console.

```bash
probevane peek [dir]
# e.g. probevane peek ./app
```

### revert
Undo a run — restore the files a run edited to its pre-run checkpoint (or remove ones it created), from the diary record. Safety net for a crashed/bad run.

```bash
probevane revert <runId> [dir]
# e.g. probevane revert run-abc123 ./app
```

### impact
Test-impact analysis — which specs are affected by the diff since <base> (transitive import graph); --run executes only those to speed CI.

```bash
probevane impact <dir> [--base <ref>] [--run] [--json]
# e.g. probevane impact . --base origin/main --run
```

### assert-score
Assertion-quality grade (0–100) of a suite — flags weak assertions (toBeDefined/toBeTruthy, tautologies, snapshot-only, bare not.toThrow) that pass without testing behavior. Complements audit (assertion-free) + bench (mutation).

```bash
probevane assert-score <dir> [--json]
# e.g. probevane assert-score ./app
```

### simcost
Simulated cost benchmark — triage a dir into easy/hard modules and compare all-api vs hybrid (local easy + api hard) vs bridge cost, grounded in measured per-module $ from the ledger.

```bash
probevane simcost [dir] [--easy N --hard M] [--local-hit R] [--json]
# e.g. probevane simcost ./app --local-hit 0.6
```

### factory
Run the gated generate loop over many repos concurrently — each with isolated state, errored repos auto-reverted + retried once — into one cost/coverage/quality rollup (report.json, with an error-mode breakdown). --resume skips repos already accepted in a prior report. Unrecognized flags forward to generate per-repo.

```bash
probevane factory <repos.txt | dir...> [--concurrency N] [--kind unit|e2e] [--report <path>] [--state-root <dir>] [--resume] [--no-retry] [--no-checkpoint] [--ship] [--emit-matrix [--out <file>]] [...generate flags]
# e.g. probevane factory repos.txt --concurrency 4 --model auto
```

### quality
Project source-quality gate — file size, function length/cyclomatic+cognitive complexity/nesting/params, long lines, debt markers (TODO/FIXME, comment-scoped), import fan-out, and (maximal-block) duplication → a 0–100 health grade. --strict exits 1 on error-severity violations (CI); --sarif emits GitHub code-scanning output; --write-baseline ratchets (gate only NEW violations on a messy repo, --no-baseline ignores it); --since <ref> scans only changed files. Complements audit (test specs), assert-score (assertions), bench (mutation).

```bash
probevane quality <dir> [--strict] [--json] [--sarif] [--write-baseline] [--no-baseline] [--since <ref>] [--max-file N] [--max-fn N] [--max-complexity N] [--max-cognitive N] [--max-nesting N] [--max-params N] [--max-width N] [--max-imports N] [--no-debt]
# e.g. probevane quality ./app --strict
```

### mfe-audit
Micro-frontend (Module Federation) standards gate — per repo: boundaries (no deep cross-remote imports), shared singletons, runtime resilience (Suspense + error boundary), typed contracts; across repos: shared version alignment. Pure analysis ($0, no LLM) → grade + violations; --strict exits 1 (CI). The fitness function the refactor loop enforces.

```bash
probevane mfe-audit <dir | repos.txt> [--repos <file>] [--json] [--strict] [--design-system <pkg>]
# e.g. probevane mfe-audit ./host --strict
```

### mfe-contract
Generate Module Federation contract tests (deterministic, $0) — remote-side compile-time conformance (exposed module satisfies its published contract) + host-side mocked tests (consume each federated remote against its contract). Auto-detects the type source (*-contracts pkg / sibling .contract.ts / @mf-types) and falls back to a structural smoke with a publish-types note. Dry-run by default; --write emits.

```bash
probevane mfe-contract <dir> [--write] [--json]
# e.g. probevane mfe-contract ./cart --write
```

### mfe
Drive the micro-frontend (Module Federation) refactor pipeline over a polyrepo fleet — per repo: audit → (contract tests) → (generate) → (fix standards via refactor --mfe --quality), then cross-repo shared-version alignment + a combined report. Default (no LLM flags) = a $0 fleet standards report; --contract adds deterministic contract tests; --generate/--fix run the loop.

```bash
probevane mfe <repos.txt | dir...> [--contract] [--generate] [--fix] [--model …] [--concurrency N] [--report <path>] [--strict] [--json]
# e.g. probevane mfe repos.txt --contract
```

### tui
The control center IN THE TERMINAL. Auto-launches the daemon (if not already up), then renders panes — cost sparkline, rune-pipeline light show, active jobs, alerts — on a diff-flushed screen (no flicker). Keys: q quit · r refresh · s drop to a shell (run generate/claude, then come back) · ↑↓ select a run · enter to replay its light show. $0 (pure client of the daemon; Ctrl-C restores the terminal).

```bash
probevane tui [--port N] [--root <stateDir>]
# e.g. probevane tui
```

### daemon
Long-running OPERATE/OBSERVE + control-center service — the LCARS control center (/) — Projects/Runs/Docs/Launch/Cost/Quality/Console tabs; the Console renders the rune pipeline as a live node graph (gate blocks flash red during watched runs, accept cascades green), telemetry gauges/sparks, the module constellation, and THEATER replay of any captured run’s light show (no loop, ␤0). Routes: /health, /aggregate, /alerts, /audit, /jobs, /queue, /metrics (Prometheus), /otel/{traces,metrics}, /pipeline, /graph, /events?runId (theater), POST /run + /enqueue + /cancel?id=. PROBEVANE_UI_DEV=1 recompiles the TSX sources per request (edit → refresh); PROBEVANE_TERMINAL=1 arms a Terminal tab — a live browser shell over a PTY (run claude/any CLI in-console) via /term/{start,stream,input,resize,kill,sessions} (opt-in; it bypasses the launch allowlist, loopback bind is the only auth). With PROBEVANE_QUEUE=1 it becomes a SUPERVISOR — pulls <state>/queue.jsonl on a tick and dispatches runs (+ships on accept with PROBEVANE_SHIP=1), lights-out. Launched jobs persist to jobs.jsonl (restart-safe); structured log rotates; periodic alert re-eval + optional webhook. Binds 127.0.0.1; read-only over ledgers.

```bash
probevane daemon [--port N] [--root <stateDir>] [--interval SEC]
# e.g. probevane daemon --port 7766
```

### ado
Azure DevOps board integration — `ado run` polls the board for tagged work items, runs the loop per item, and reports progress back as state moves + comments; `ado create` files a task. Auth via AZURE_DEVOPS_PAT.

```bash
probevane ado <run|create> [--project P] [--org O] [--tag probevane] [--title "<t>"] [--type Issue]
# e.g. probevane ado run --project probevane
```

### docs
Stack-agnostic narrative documentation loop — grounds a model on a language-agnostic project digest and writes a comprehensive long-form Markdown guide, gated so it cites only real paths (anti-hallucination). Unlike `document` (JSDoc on source) and `spec` (TS-import structured dump), works on any language.

```bash
probevane docs <dir> [--out <path>] [--sections a,b,c] [--model …] [--max-steps N] [--budget N]
# e.g. probevane docs ./app --model bridge
```

### pipeline
Describe the loop pipeline a config assembles, WITHOUT running it — profile() is a pure (config) to Rune[] function, so the runes/hooks/phases are derivable. Prints a phase-grouped listing + Mermaid; powers the wiki "Loop pipeline" interactive demo.

```bash
probevane pipeline [--profile feature] [--kind unit|e2e] [--quality --mutation --flake --a11y --visual --mfe --min-tests N --min-coverage P] [--json | --mermaid <out> | --emit-model <file>]
# e.g. probevane pipeline --profile feature --quality --json
```

### intake
Turn a simple NL prompt into a frozen, machine-checkable RunSpec ($0, no LLM required): classify the task path, ask the few clarifying questions (interactive TTY) or read a policy file (--answers), and persist <state>/specs/<id>.json — the specification a dark run executes. One spec object, two fill-modes.

```bash
probevane intake "<prompt>" <dir> [--answers f.json | --interactive] [--model m] [--takeover t] [--strict] [--json] [--root <state>]
# e.g. probevane intake "add unit tests" ./app --answers policy.json
```

### factory-dark
The dark factory: prompt → RunSpec (intake) → per-file decomposition (buildPlan) → enqueue each single-file unit onto the supervisor queue. A daemon with PROBEVANE_QUEUE=1 runs them unattended, ships accepted units, and PARKS deterministic give-ups (difficulty/max_steps/stuck) with the stop reason instead of blind-retrying. --dry-run previews units; --report <batchId> rolls the ledger up per unit (accepted/parked/pending).

```bash
probevane factory-dark "<prompt>" <dir> [--answers f.json | --interactive] [--model m] [--dry-run] [--root <state>] [--json] | probevane factory-dark --report <batchId> [--root <state>]
# e.g. probevane factory-dark "add tests" ./app --answers policy.json --model ollama
```
