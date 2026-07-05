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

## Design invariants

1. **The loop never imports a vendor SDK.** It talks to `Brain` and `StackAdapter` only. Swapping the model or the stack touches one file/folder.
2. **The model never decides "done".** Finishing is a *gate* (`shouldStop`), evaluated by code that runs the real tests — not a claim the model makes.
3. **The model never guesses ground truth.** `adapter.probe()` gathers real exports/DOM/routes before generation (P2/P3); a failed probe is a hard block.
4. **Metrics are append-only.** The improvement-log is never rewritten (fourier rule).

See [The Loop](The-Loop.md) and [Adapters](Adapters.md) for detail.
