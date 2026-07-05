# Phase Log

Each phase ships verified behind a gate (fourier discipline). Full plan: `~/.claude/plans/hi-we-recently-had-jaunty-axolotl.md`.

## P0 — Skeleton + react adapter + fixture ✅
- `StackAdapter` contract + registry; react-vitest-playwright adapter (detect/install/discover/run/coverage); python-pytest stub.
- CLI: init/run/coverage/status/eval. `react-todo` fixture with one hand-written passing test. Append-only improvement-log.
- **Gate met:** harness `tsc` clean; `probevane run` GREEN (2 passed); coverage 92.85%; `eval` 1/1, baseline row written.

## P1 — Gated loop + plan_first + validation_gate + brain ✅
- Ported the Rune contract (`rune.ts`/`ctx.ts`) and loop (`engine.ts`) from runestone. Provider-neutral transcript/tool types. Tool surface (read/list/write/edit/plan).
- `anthropic-sdk` brain (Haiku, retrying). Runes: `plan_first`, `validation_gate`. `write_tests` profile. `generate` CLI.
- **Gate met:** on a zero-test scratch copy of `react-todo`, the loop planned (step 5, before any write — plan_first enforced), wrote a real 22-assertion test, and `validation_gate` accepted only on green. Independent re-run: 22/22 pass. 7 steps, ~19k/3k tokens, 0 gate blocks.

## P2 — Unit gen + library + audit_gate + context_inject ✅
- `audit/core.ts` (rule engine + suppression, ported from qaforge `audit.ts`) + `rules-js.ts`; `audit_gate` rune; `audit` CLI.
- Real React **unit probe** (`probe.ts`) — extracts exports/components/functions/props/aria-labels as ground truth; `generate` folds digests into the task so the model never guesses.
- Learning library at `~/.local/share/probevane/` (store/retrieve, `index.jsonl`, stack-tagged), `context_inject` rune injects quality rules + `unit-patterns.md` + few-shot; `learn` CLI curates.
- **First run got stuck** (22 steps, 160k tokens): model wrote empty placeholder files, had no delete tool, and never attempted to stop so `validation_gate` never ran. Fixes: added `delete_file` tool, a one-time **barren nudge** (finish-or-clean-up → triggers the stop→validate loop), tightened the prompt (one spec file, no empty stubs, stop when done). See ADR-006.
- **Gate met (after fix):** zero-test react-todo → ACCEPTED in 6 steps, single `App.test.tsx`, **31 tests, 100% coverage**, audit 5/5, 27.6k tokens (6× cheaper). `learn` round-trips the spec into the library.

## P3 — E2E gen + acceptance_gate + no_regression ✅
- E2E **probe** (`probe.ts` `probeReactE2e`) — app-wide UI inventory (aria-labels, roles, button text, placeholders, headings, routes) from JSX; grounds the e2e spec so the model targets only real selectors.
- `acceptance_gate` (minTests / minCoverage / shell checks) + `no_regression` (snapshots pre-existing specs; blocks any edit/delete of them) + scope-aware `validation_gate` (unit ↔ e2e). `e2e-patterns.md`.
- Fixed an install bug: `install()` skipped **all** deps when vitest existed, so Playwright never landed. Now installs unit + e2e dep groups independently.
- **Gate met:** zero-test react-todo → ACCEPTED in 9 steps (1 validation block → fixed), **7 Playwright tests** (add/toggle/untoggle/delete/multiple/whitespace), **flake 0** over 3 runs, 55k tokens. `no_regression` proven: the pre-existing unit spec was untouched (md5 identical).
## P4 — Eval hardened + CI + caveat_harvest + diary ✅
- `react-forms` fixture (form + validation, golden suite). `eval/scorer.ts` (green/tests/audit/coverage/flake/shadow-oracle) + baseline `judge` vs `eval/baseline/*.json`.
- `eval` CLI: default = CI no-LLM scoring + no-regression gate; `--live` copies fixture, strips tests, regenerates from zero (shared `run-generation.ts` core), scores the generated suite.
- `session_diary` (per-run metrics → `<workdir>/.probevane/diary/`) + `caveat_harvest` (gate-block reasons → shared `caveats.md`, read back by `context_inject`). Both added to the `write_tests` profile.
- CI `.github/workflows/eval.yml`: ci-baseline on push/PR, nightly `--live`.
- **Gate met:** CI eval 2/2 fixtures PASS (flake 0, audit 5/5, oracle 3/3); 7 append-only improvement-log rows; diary verified; live generation proven on react-forms (7 steps, ACCEPTED).
## P5 — python-pytest adapter (modularity proof) ✅
- `py-calc` fixture (calc module + golden suite), full `python-pytest` adapter (detect/install/discover/probe/run/coverage/specFiles/guidance/patternsDoc/audit/commands), `rules-py.ts`, `py-unit-patterns.md`. JUnit-XML parse (reliable counts under any `-q`).
- **Finding:** the 2nd stack surfaced 3 implicit React-isms in the core — spec-file discovery, generation guidance, and patterns were JS-hardcoded. Fixed by adding `specFiles` / `guidance` / `patternsDoc` to the `StackAdapter` contract and routing all callers through the adapter. Core *logic* (engine, runes, gates, scorer, library store) unchanged. See ADR-007.
- **Gate met:** CI eval 3/3 incl py-calc (5 tests, 100% cov, audit 5/5, flake 0); live pytest generation from zero → ACCEPTED in 4 steps, 22 passing tests, 12k tokens — same loop/gates/brain, only the adapter differs. A 3rd stack is now a pure drop-in.
## Improvement Batch (Mocks · Tuning · Gates · Vue)

### M1 — Token tuning ✅
- Prompt caching (`anthropic-sdk.ts`): system block + tools marked `cache_control: ephemeral` → every turn after the first re-reads the stable prefix from cache. `capOutput` (head+tail) on tool results; `pruneOldToolResults` stubs tool bodies older than 8 turns (files persist on disk). Cache telemetry surfaced (`cacheRead`).
- **Gate met:** react-todo unit gen → billed input 16.4k (was ~27.6k) + 33.5k cached (≈10% cost); steps 2–7 all cache-hit; `eval` still 3/3, behavior unchanged.

### M2 — Gate tightening ✅
- New JS audit rules: `conditional-expect`, `assertion-free-block` (errors), `snapshot-only`, `unused-import-in-test` (warns) — anti coverage-gaming.
- `hermetic_gate` (shouldStop, in profile): blocks tests that hit a real network (external URL / un-mocked fetch) or real clock/random (Date.now/Math.random without fake timers). Enforces determinism + that mocks are used.
- `mutation_gate` (opt-in `--mutation`): mutates source operators, requires the suite to kill them (score ≥ 60%).
- **Gate met:** crafted bad specs each rejected (audit 2 errors; hermetic blocks external-URL / un-mocked-net / uncontrolled-time, allows mocked); `eval` still 3/3, golden fixtures unaffected.

### M3 — Mock maker core ✅
- `src/mock/` (graph → synth → store) + `mock_inject` rune + `probevane mock` CLI + `generate --mock`. MSW added to React install; handlers synthesized from OpenAPI schema (→ TS types → LLM), server started globally in `vitest.setup.ts` (`onUnhandledRequest: 'error'`). New multi-module networked fixture `fixtures/react-shop`. See [Mock Maker](Mock-Maker.md).
- Two synth bugs fixed during the run: `${BASE}` const resolution + type-only imports excluded from dep-mocks; and the architectural fix — **global** MSW setup so specs need only async waiting, not per-test lifecycle.
- **Gate met:** react-shop from zero → **31 hermetic tests**, flake 0 (3×), 90.81% coverage, **no real backend**; model used synthesized handlers + `server.use` overrides for success/loading/error paths.

### M4 — Chaining (auto module graph) ✅
- `src/mock/contract.ts`: `materializeFixtures` (each fetcher's array sample → `test-fixtures/<name>.json`, handlers import it = single source of truth) + `captureContracts` (pure transformers executed over the fixtures via an in-project tsx harness, outputs frozen in `contracts.json`). `buildChain` orchestrates; threaded into `mock_inject`.
- Fixed capture noise: only 1-arg functions whose output is a sensible object (no NaN) are captured (so `formatPrice(number)` isn't fed the array).
- **Gate met:** react-shop → 38 tests, 100% cov; `api`/`useProducts`/`App` tests all assert the **same** `test-fixtures/products.json` (the frozen upstream output), and `format`'s `inStockOnly` contract is reused downstream — output→next-input chain, no re-mocks.

### M5 — Vue adapter (modularity re-proof) ✅
- `src/adapters/vue-vitest-playwright/` (detect/install/discover/probe SFC/run/coverage/specFiles/guidance/patternsDoc/commands), `audit/rules-vue.ts` (= JS rules + `vue-await-trigger`), `prompts/vue-{unit,e2e}-patterns.md`, `fixtures/vue-counter`, eval case+baseline. Reuses the loop, **mock maker**, audit core, library, scorer **unchanged**.
- **Modularity proof:** adding Vue touched only the new adapter folder + `rules-vue.ts` + vue prompts + fixture + eval baseline + **1 registration line** in `registry.ts`. Zero edits to `src/loop`, `src/mock`, `src/audit/core.ts`, `src/library`, `src/brain`, `eval/scorer.ts`.
- **Gate met:** all 4 fixtures self-score in CI (vue-counter 7 tests @ 100%, audit 5/5, flake 0); live Vue gen from zero → ACCEPTED 9 steps, 27 tests @ 100% coverage, `@vue/test-utils` mount + awaited triggers.

**Batch complete.** probevane now adds hermetic, mock-backed unit + e2e tests to React, Vue, and Python projects, with token-cached generation, anti-gaming gates, and a mock maker that chains module contracts across the dependency graph.

### Paths + Improvements Batch ✅
Turned probevane from a test-adder into a general code-evolution harness. See [Paths](Paths.md).
- **A · Foundations**: ts-morph **AST probe** (accurate exports/params/types/props, regex fallback) — verified on react-shop + realworld slices; `probevane.config.{ts,json}` loader (flag > config > default).
- **B · Paths**: **refactor** (`behavior_lock`: snapshot green tests → change source only → same tests stay green) + **feature** (`red_first`: failing spec first → implement → green). Both rune-gates proven deterministically (block/allow paths).
- **C · Engine**: coverage-gap targeting (`coverage-final.json` → uncovered lines/fns, `--target-gaps`); **test-repair** path (`git diff` → update affected specs); **flake hunter** (`--flake-guard`, rejects non-deterministic specs — proven by catching a `Math.random` test).
- **D · Reach**: **local-model** backend (OpenAI-compatible, `--model local:<id>`; mapping unit-verified); **Svelte + Go** adapters (now **5 stacks / 3 languages**, all self-score in CI — go-calc 4 tests, svelte-counter 6 tests); **CI Action** (`action.yml` + `probevane ci`: changed-untested report + coverage + optional generate/comment).
- **Gate met:** `probevane eval` is **6/6** (react-todo, react-forms, py-calc, vue-counter, go-calc, svelte-counter); every new gate exercised deterministically. Live LLM path runs await API credits (ran out mid-batch).

### Real-app hardening (follow-on) ✅
Tested on a real 44-module production app (RealWorld: CRA + axios + redux + react-router, React 17). Fixes so it generates real tests there:
- **Install**: React-version-matched `@testing-library/react` (RTL 12 for React 17, not forced 18); `--legacy-peer-deps`; `vite-tsconfig-paths` + `css:false` so component imports resolve aliases and ignore CSS; **vitest config written as `.mts`** (ESM — a `.ts` config fails on `vite-tsconfig-paths` in a non-module project); **CRA-aware** Playwright webServer (npm start / :3000 vs Vite :5173).
- **Gates**: `validation_gate` is **baseline-aware** (skips typecheck if the app didn't typecheck cleanly to begin with) and **scopes the run to the specs we wrote** (`run(dir, scope, files)`), so a real app's pre-existing (jest-era, env-incompatible) suite doesn't block acceptance.
- **Mock setup**: the MSW patch no longer clobbers the jest-dom matcher import (was breaking every component test with "Invalid Chai property: toBeInTheDocument").
- **Targeting**: `discover` ranks by **testability** — pure helpers / types / redux slices / hooks before heavy components needing providers — so `--max-targets` picks winnable modules. Probe now reads redux-slice exports (`export const { a } = slice.actions`, `export default slice.reducer`) and `export async function`.
- **Result:** probevane generated **22 passing hermetic tests on real production redux slices** (Home.slice + Login.slice). Honest gap: the weak default model (Haiku) sometimes needs more than the step budget to cleanly *stop* on complex real code (the tests it wrote were green) — raise `--max-steps` or use a stronger model for big apps. See ADR-011.

### Showcase + docs (follow-on) ✅
- `probevane graph <dir>` — renders the module dependency graph (ASCII tree + Mermaid `--mermaid`), nodes classified (fetcher/hook/component/util) + network-flagged. See [Mock Maker](Mock-Maker.md).
- `probevane spec <dir>` (or `generate --spec`) — generates `SPEC.md` from the graph + probes + mock plan + coverage: overview, module graph, per-module exports/deps, API surface. `--narrate` adds an LLM one-liner per module. Produced standalone or as part of a loop run.
- Fixed a probe bug surfaced by the spec: `export async function` wasn't extracted (so fetchers' exports were invisible to generation) — now matched.
- **Wiki integration:** the self-served wiki now renders Mermaid diagrams (CDN) and groups the sidebar into **probevane** (core docs) and **Projects** (per-project specs). `probevane spec <dir> --wiki` publishes `docs/wiki/project-<name>.md`; `react-shop` + `vue-counter` published as examples. See [Projects](Projects.md).

## P6 — Consult ladder + takeover + first real run ✅
- **Consult ladder + takeover** (`engine.ts`): when stalled, escalate once — inject extra guidance (a library exemplar via `onConsult`) and hand the window to a stronger brain (`--takeover`, default `claude-sonnet-4-6`), still under all gates. `forceStopAfter` is the final give-up.
- **First real run** on a *fresh, unseen* React app (tip calculator, not a fixture): unit → 22 tests @ 100% cov, audit 5/5; e2e → 5 Playwright tests, flake 0 over 3 runs; `no_regression` kept the unit suite green while e2e was added. Zero human edits to the generated specs.
- **Two bugs the real run surfaced:**
  1. **No `path_guard`** — a model stuck on a typecheck failure started editing `node_modules/.bin/tsc` (writes to deps live *inside* the project, so the `..`/absolute guards didn't catch it). Added the `path_guard` rune (deny node_modules / build / lockfiles). See ADR-008.
  2. **Premature takeover** — `barren` counted the initial read/plan turns, so takeover fired on every run. Fixed: escalation only counts after the first productive edit (runestone's force_stop lesson).
- **Status: all phases complete.** Probevane adds unit + e2e tests to React and Python projects through one gated, self-correcting, self-evaluating loop.

## Post-P6 — Cost observability + the local-agent arc ✅

A follow-on push to make runs **measurable** and to chase a **$0** path. (Brains/economics detail in [Brains](Brains.md).)

- **Cost ledger + `history`** — every run logged to `~/.local/share/probevane/runs.jsonl` (tokens, real $ with cache-read at 0.1×, accepted/takeover, per-model/per-path). Made the hard-module cost problem measurable; revealed Opus-takeover as a sink → routing now keeps takeover on **Sonnet** (auto), Opus opt-in.
- **Smarter + cheaper loop** — **transcript prompt caching** (2nd `cache_control` on the stable pruned prefix; ~11%/15-step run); **difficulty gate** (stops a circling run + proposes, deterministic + optional LLM turn); **exemplar-RAG on stall** (selective retrieval, failures-only — a fourier-nca lesson); **flywheel** (`library_promote` auto-promotes accepted specs so few-shot starts hitting); **trace gate-feedback enrichment**.
- **Four brain backends** — added **`claude-code`** (drives the loop via headless `claude -p`) and **`bridge`** (a subagent in the host Claude Code session services each turn over a filesystem queue; the `probevane-brain` skill packages it). Bridge = the working **$0 path** (90 runs, $0; harvested 97 traces / 8 stacks).
- **LoRA distillation, end-to-end** — harvest accepted traces → `distill build` → QLoRA 4-bit Qwen2.5-Coder-3B (RDNA4) → serve → eval. Result, honest: convention learned, **facts not bound** (3B & 14B both invent IDs/rates) — RAG-beats-distillation, again. The **gated repair loop is the lever**, not the adapter.
- **Hybrid + cost benchmark** — `triage.isEasyTarget` (fact-density signal) routes pure/low-fact modules → local ($0), the rest → bridge; `draft-local.ts` is the focused per-target local drafter (verify with the same gates, never clobber an existing spec); **`simcost`** compares all-api vs hybrid vs bridge over measured per-module $. Hybrid pays only on **easy/pure-heavy** codebases (CRUD −31%; glue-heavy ~0%).
- **Loop hardening (dogfood)** — scoped `hermetic_gate` + `audit_gate` to **run-edited specs only** (a whole-suite scan + `no_regression` was a deadlock); `validation_gate` leads feedback with the **first failure** (focus-one); never-edited difficulty stop for non-writing models.
- **Azure DevOps** — `ado run` polls a board for tagged work items, runs the loop, reports back as state moves + comments (live-proven); `ado create` files a task.

**Takeaway:** local's $ value is real but **narrow** — convention-emit the easy band, bridge/API the rest; for glue-heavy codebases just use the API. The scaffold (gates + repair) carries the run; the model tier sets the ceiling.

## Polish session — detect, fix, then bake the detectors in (2026-07-02) ✅

A "what can we test, measure or improve?" sweep: 3 explore agents + live runs surfaced real defects, every fix landed, and the *classes* of defect became permanent `doctor` checks. 27 commits, merged as PR #1 (all checks green).

- **Live defects found red, fixed green** — `eval` was 7/8 for days: the host's system python lost pytest and PEP 668 blocked pip; the python adapter now bootstraps a project-local `.venv` and `eval` self-installs toolchains (8/8). Path eval was 1/3: cassettes were stale against ~120 commits of prompt drift — re-recorded via the **$0 bridge** (3/3; `--record` now sidecars and only replaces a cassette when the run ACCEPTS; replay misses dump to `<cassette>.miss.json`). Own coverage gate was silently red at 89.6%: the daemon extraction added 534 LOC that **no test ever loaded** — invisible to the denominator. Restored to 96% (daemon routes 0→99%).
- **Eval widened 8→10 cases** — `node-calc` (node-vitest was the only adapter with no fixture) and `react-shop` (the mock-maker fixture's 23-test suite was gitignore'd as regenerable output; committed + baselined at measured floors). Mutation floor raised 0.5→**0.6** from two measured runs (1.0, 0.8) — ADR-014.
- **`probevane doctor <dir> [--fix] [--full]`** — 12 health checks, each a generalization of an issue that bit for real (provenance documented in `src/doctor/checks.ts`): toolchain bootstrap, coverage blind spots, tracked artifacts, manifest lies, CI `|| true`, stale cassettes, missing node_modules/browsers, invalid config, credentials, eval bijection, stale coverage reports. `--full` = read-only grader scorecard. Dogfooded immediately: found its own tracked `.pyc`s, then its first `--full` run showed today's commits had pushed probevane past its **own quality gate** (grade 46, 8 errors) — refactored to 90/100 @ 0 errors.
- **Two harness bugs the session itself exposed** — (1) `sh()` timeouts killed only bash: a mutant-induced infinite loop orphaned vitest workers for **3.5h**; now spawns detached + kills the process group (every gate shells through `sh()`). (2) Four audit-rule false-positive classes — TS discriminated-union narrowing, Playwright hooks matched as tests, fixture *strings* matched as calls, brace-in-string truncating the body scan — own 93-file suite went 53 errors → **audit 5/5** (rules now match on ADR-013's literal-stripped view; 13 regression tests).
- **First honest CI validation** — the branch had 141 unpushed commits; CI had never seen them. Three PR rounds, each catching something real: the angular fixture's install was *genuinely broken* (peer conflict hidden by `|| true` its entire life), then `--legacy-peer-deps` skipped `@testing-library/dom` so all react fixtures collected 0 tests (clean-room reproduced + fixed). Round 3: **all green** — selftest (typecheck → coverage floors → mutation 0.6 → e2e → eval 10/10 → paths 3/3) + ci-baseline.
- **Measurement debt paid** — run `durationMs` → real otel span widths (were zero-width) + `history --trend` (daily table + the daemon's alerts, in the CLI); mutation/cost/token columns in the append-only improvement-log via **header versioning** (a schema change appends a new header line; old eras parse with their own columns); committed arch-coupling snapshot + `archDrift` report (30 dirs, 0 cycles). `--help` on all 51 commands, rendered from the drift-gated catalog.

**Takeaway:** the polish loop compounds — every manual find became a detector, the detectors immediately found more (including in the code that implements them), and the fail-loud CI change proved itself within one push by catching a fixture that had never actually installed.

## UI arc — TSX console, light show, theater (2026-07-02 → 07-03) ✅

The control center went from a 456-line inline-HTML monolith to a component system that dogfoods the harness's own gates (full record in [Control Center](Control-Center.md), design rules in ADR-015).

- **TSX without a framework** — `h()` runtime (real DOM, text-node-safe), components resolved by NAME at compile time (missing file = build error; bijection + factory-shadow guards). `control.html` stays one generated, drift-gated file; `PROBEVANE_UI_DEV` = per-request runtime compiler (edit → refresh, ~20ms).
- **LCARS console** — full-theme restyle (selector parity verified with the design loop's own `cssSelectors`), ring gauges + glow sparks off `/aggregate`, and two node graphs from a pure layered-DAG layout: the live rune pipeline (`/pipeline`, derived from `describePipeline`) and the module constellation (`/graph`, connected top-fan-in subgraph).
- **Light show** — block decisions now carry the blocking RUNE's name into the event stream; watching a run drives the pipeline graph (block flashes red → productive call cools it → accept cascades green). Proven on a $0 replay AND on a UI-launched bridge run whose event log read: read → plan → BLOCK no_regression → write → edit → BLOCK validation_gate → accepted.
- **Theater** — every run also writes a durable event copy to `<state>/events/<runId>.jsonl` (workdir copies die with temp dirs — the old "no transcript captured" complaint); `/events?runId` + a **replay show ▶** button play any captured run's show at compressed cadence: no loop, no model, $0.
- **Dogfood found real bugs at every step** — the quality gate flagged the UI's own code three times (split each time); the design loop's first ungated rewrite gutted the stylesheet → selector-preservation gate (its next rewrite dropped 66 selectors and was auto-reverted); the refinement loop caught poll-driven animation replay + a tiled background vignette; the UI-launched demo exposed that CLI/daemon loop entries never ran `adapter.install()` (the PEP-668 class at a third entry point) and that a `const h` local silently shadowed the JSX factory — now a hard build error.

**Takeaway:** the same discipline that guards generated tests transferred wholesale to the UI: generated artifact + drift gate, contracts enforced not requested, and every convenience (convention imports, runtime compile) backed by a check that fails loudly.

## Terminal tab — a live shell in the console (2026-07-03) ✅

`PROBEVANE_TERMINAL=1` adds a Terminal tab to the control center: xterm.js (CDN) attached to a daemon-managed PTY, so `claude` or any agentic CLI runs in-browser next to the light show. Transport is SSE-down + POST-up (base64 frames survive raw ANSI; no `ws` dep); the tty comes from a stdlib-only `scripts/pty-bridge.py` (`pty.fork` + select loop) — no node-pty native module, keeping the two-runtime-dep invariant. Trust boundary is deliberate and separate from the `LAUNCH_OPS` allowlist: a terminal is a shell, so it's off unless opted in, `/term/*` return 403 otherwise, and 127.0.0.1 stays the only auth (documented loudly). Proven in-browser: spawning the shell dropped into a full-screen interactive TUI (the p10k wizard) with live colors/cursor/resize; the XSS spec confirmed xterm glyph-renders output (0 DOM images, `window.__XSS` undefined). 14 unit tests against the REAL python3 bridge + 2 e2e. TUI-mode `probevane tui` sketched as the next phase (raw-ANSI dashboard, pure client of `/aggregate` `/jobs` `/pipeline`).

## `probevane tui` — control center in the terminal (2026-07-03) ✅

The command center, without a browser. `probevane tui` auto-launches the daemon (probes /health; spawns a detached one on refusal) and renders four panes — cost sparkline, rune-pipeline light-show, jobs, alerts — on a diff-flushed cell grid (only changed cells emit ANSI → no flicker, unlike `peek`'s full repaint). Keys: q/r/s(shell)/↑↓+enter(replay a run's light show). Same "build our own simple runtime" move as the browser TSX work, dogfooding hard: it's a pure HTTP client of the daemon it spawns, and the layered-DAG **layout** + the light-show **`pipelineReducer`** are lifted into shared modules (`src/tui/layout.ts`, `src/observe/pipeline.ts`) so the browser SVG graph and the terminal ANSI graph run identical code — one machine, two renderers. Pure cores unit-tested; the mutation gate drove them 0.825 → 0.95 (killed box-border / style-equality / lamp survivors); the embedded shell (`s`) is where you run `generate`/`claude`, then replay what you ran. Proven live: the TUI rendered every pane against a real daemon (pipeline showing `context_inject`…), and `probevane tui` with no daemon up spawned its own. Terminal glue lives in `src/cli/tui*.ts` (coverage-excluded like all cli/); pure render in `src/tui/` under the gate. 1387 unit + 9 e2e green, quality 0, drift green.

## facet — a dual-target drawing engine, vendored (2026-07-04 → 07-05) ✅

The TUI-vs-browser duplication ended: one vector `Painter`, two backends, every widget authored once. Extracted into **facet**, grown into a 44-widget component library, integrated back into both control centers, gated, then vendored in-repo so probevane ships as one package. Full record in [Drawing Engine](Drawing-Engine.md); ADR-016 (engine), ADR-017 (vendoring), ADR-018 (gates).

- **One machine, two renderers** — an abstract `Painter` (`rect/line/arc/text/…` + a `caps` record) with `CellPainter` (box-drawing + **braille** 2×4 subpixels) and `SvgPainter` (DOM-free SVG string). The seam was already latent — `Style` was packed `0xRRGGBB`, `layoutDag` + the constellation builder were shared — so only the *drawing* was duplicated. Where a shape reads differently per medium, the **backend** compensates, not the widget: `CellPainter.arc` squashes the vertical radius so a gauge is round in a 1:2 cell while SVG stays round, the widget none the wiser. The go/no-go was a side-by-side catalog before any hand-tuned draw code was deleted.
- **34 → 44 widgets, MUI breadth** — from a handful of graphical widgets to a browser-GUI-library-sized set: inputs, feedback, display, navigation, controls, **charts** (barChart/donut/heatmap/legend/meter), and state (skeleton/emptyState/scrollbar). Interactive controls are static visual states (props, not behaviour), which keeps the both-backend invariant honest. What's excluded is deliberate — layout primitives, portal overlays, interaction-only widgets, icon sets.
- **Two showcases, both dogfooding** — an HTML catalog (every widget in both backends + a usage snippet) and an **in-terminal storybook** (`↑↓` a component → live cell preview; the chrome drawn with facet's own widgets, the rail windowing so all 44 fit any height).
- **Wired back into the control center** — the terminal panes now render through the engine via a `paintWidget` bridge: Projects as a `card` grid (run-count `badge` + accept `progress`), Launch as a `menu`, the Console hero gaining `stat` blocks + a run-phase `stepper` + a recent-runs `timeline`, Cost gaining a daily-cost `barChart` + an acceptance `donut` + `legend`, and `emptyState` for empty panes. Browser Gauge/Spark/NodeGraph draw through `SvgPainter` — one authoring, both media, verified pixel-adjacent in the catalog.
- **Every rendering bug this cycle was caught by a person, so each became a gate** — the gauge egg-shape, a garbled stepper, and SVG typography were found on screenshots → a deterministic **cell + SVG snapshot** per widget (88). A widget could silently no-op in one backend → a **parity** oracle over all 44 (was 2). facet had no CI and no lint → its own workflow + a bloat gate. And the one that reached a user: `probevane tui` crashed with `ERR_MODULE_NOT_FOUND` because the `dist build` gate only *compiled* dist, never *ran* it → a **dist smoke-run** gate (imports the TUI graph + runs a CLI; reproduces and catches the exact crash), plus a **UI perf** gate (diff-flush ≤3% of a full repaint — measured 0.2%; `control.html` ≤80 kB). A **pre-commit** hook (typecheck + drift + quality) catches the rest before push.
- **Shipped as one package** — vendored from a sibling repo into `engine/*` workspace packages; imports stay `@facet/*`, `dist/` esbuild-bundles the engine to `dist/node_modules/@facet/*` so plain node runs it (the file-dep debt that caused the crash, retired). Verified: a lone checkout installs/builds/smokes with the sibling repo deleted, and `npm pack` ships + resolves the bundle. The standalone facet repo was tar-archived, history intact.

**Takeaway:** the same discipline that guards generated tests transferred to the drawing layer — one authoring surface with a parity oracle, rendering changes frozen as snapshots, and the gaps a human caught (unrunnable dist, unmeasured perf, eyeballed visuals) each converted into a check that fails loudly. probevane went from depending on a sibling repo to being one self-contained, gated package. 1473 probevane + 228 engine tests, all CI gates green, merged to master.
