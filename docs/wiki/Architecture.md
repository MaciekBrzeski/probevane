# Architecture

Everything language-specific hides behind one interface (`StackAdapter`); everything else is stack-agnostic.

```
                       probevane generate <dir>
                                  │
                                  ▼
        ┌──────────────────  the loop (engine.ts)  ──────────────────┐
        │   assemble system = base + Σ rune.systemPromptAddition       │
        │                       + Σ rune.prepare (RAG, P2)             │
        │                                                              │
        │   while not accepted:                                        │
        │     brain.complete(system, messages, tools) ───► Brain       │
        │     for each tool call:                                      │
        │        firstBlockBefore(runes) ─► Rune.beforeToolCall        │
        │        execTool() ───────────────► tools.ts (read/write/...) │
        │     if model stops:                                          │
        │        firstBlockStop(runes) ──► Rune.shouldStop  ──► Adapter│
        │        block → inject feedback, continue                     │
        │        allow → ACCEPT                                        │
        └──────────────────────────────────────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        StackAdapter           Runes              Brain
   (react-vitest-playwright)  (plan_first,     (anthropic-sdk)
   detect/install/probe/      validation_gate)
   discover/run/coverage
```

## Modules

| Path | Role | Stack-specific? |
|---|---|---|
| `src/adapters/adapter.ts` | the `StackAdapter` contract | no (the contract) |
| `src/adapters/react-vitest-playwright/` | React adapter | **yes** |
| `src/adapters/python-pytest/` | Python stub adapter | **yes** |
| `src/adapters/registry.ts` | pick adapter by `detect()` confidence | no |
| `src/loop/engine.ts` | the gated turn loop | no |
| `src/loop/rune.ts` · `ctx.ts` | Rune contract + shared `RunCtx` | no |
| `src/loop/runes/*` | individual gates | no |
| `src/loop/tools.ts` | the tool surface (read/list/write/edit/plan) | no |
| `src/brain/anthropic-sdk.ts` | LLM driver | no |
| `src/audit/rules-js.ts` | JS/TS audit rules | yes (lives in adapter's domain) |
| `src/library/improvement-log.ts` | append-only metrics log | no |
| `src/tui/*` · `src/ui/app/*` | the control center (terminal + browser), both drawing through the engine | no |
| `engine/*` | the **facet** drawing engine — one `Painter`, two backends (SVG + cells); vendored workspace packages | no |
| `fixtures/` | test subjects | (each is a project) |
| `eval/` | the harness's own test suite | no |

The control center is rendered twice — the browser dashboard and `probevane tui` — from **one** authoring surface. The [Drawing Engine (facet)](Drawing-Engine.md) is a dual-target `Painter`: a widget is drawn once and rasterized to crisp SVG in the browser and braille/box cells in the terminal. It's vendored in-repo (`engine/*` workspace packages, bundled into `dist/`) so probevane ships as one self-contained package.

## Domain map

`src/` is deliberately **flat** — 33 top-level entries (31 dirs + `config.ts`, `git.ts`). This is a *logical* map over that tree, not a folder layout; the groups are the import-edge clusters the [`arch`](Commands.md) report computes (fan-in/out in `src/arch/metrics.ts`), written down where a reader looks first.

| Domain | Dirs | What it does |
|---|---|---|
| **The loop** | `loop` · `brain` · `adapters` · `mock` · `plan` | The gated agentic engine: drive the model, gate each turn, synthesize the mock boundary, build the deterministic action plan. |
| **Gates & analysis** | `audit` · `quality` · `arch` · `review` · `a11y` · `mfe` · `visual` · `coverage` · `e2e` | Grade and critique code + artifacts — test-quality audit, source-quality analyzer, structural critique, diff review, a11y rules, MFE contracts, visual checkpoint, coverage gaps. |
| **Presentation** | `ui` (browser) · `tui` (terminal) | The control center in two media over one shared theme SSOT — both draw through the [Drawing Engine](Drawing-Engine.md). |
| **Ops & fleet** | `server` · `observe` · `factory` · `doctor` · `ship` · `integrations` | The daemon + HTTP surface, cross-repo observe/aggregate, fleet matrix, health checks, PR construction, ADO. |
| **Knowledge & docs** | `library` · `distill` · `spec` · `docs` · `skill` · `search` | Learn and describe — the caveat/example library, trace→dataset distillation, SPEC generation, the docs digest, the command catalog → SKILL.md, the search index. |
| **Composition root** | `cli` | The command entrypoints; imports ~every domain. Stays at `src/` root — `bin/probevane` dispatches to `dist/cli/$name.js` (dist mirrors `src`). |
| **Shared leaves** | `util` · `cost` · `config.ts` · `git.ts` | Cross every domain — exec/pool primitives, the cost ledger/budget, config loader, git helpers. |

**Why a map, not folders.** Physical regrouping was weighed and declined: imports are 735 hand-written relative `.js` paths with no alias layer (`moduleResolution: Bundler`, no tsconfig `paths`), so a move rewrites every `../dir/` prefix + every importer and ~40 hardcoded `src/<dir>` refs (vitest excludes, build/smoke/bench scripts, tsconfigs, the `dist`-mirror `bin` dispatch). And `util`/`cost`/`adapters` are shared leaves that straddle any boundary. The tree is already gated + cycle-free, so the churn/risk buys only tidiness — this map captures the navigability without it.

## Design invariants

1. **The loop never imports a vendor SDK.** It talks to `Brain` and `StackAdapter` only. Swapping the model or the stack touches one file/folder.
2. **The model never decides "done".** Finishing is a *gate* (`shouldStop`), evaluated by code that runs the real tests — not a claim the model makes.
3. **The model never guesses ground truth.** `adapter.probe()` gathers real exports/DOM/routes before generation (P2/P3); a failed probe is a hard block.
4. **Metrics are append-only.** The improvement-log is never rewritten (fourier rule).

See [The Loop](The-Loop.md) and [Adapters](Adapters.md) for detail.
