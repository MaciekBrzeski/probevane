# Audit & the Learning Library

Two qaforge-derived mechanisms: a static **audit** that gates quality, and a cross-project **learning library** that feeds few-shot examples back into generation.

## Audit (`src/audit/`)

A language-agnostic line scanner (`core.ts`) + per-stack rules. Adapters supply rules via `auditRules()`; the engine scans and collects violations.

- **Suppression:** a line (or the line above) containing `probevane-allow: <rule-id>` silences that rule.
- **Score:** 0..5 (5 = clean); each error −1.5, each warn −0.5. Mirrors the improvement-log scale.

### JS/TS rules (`rules-js.ts`, ported from qaforge `audit.ts`)
| Rule | Severity | Catches |
|---|---|---|
| `no-wait-for-timeout` | error | brittle fixed waits |
| `no-only` | error | `.only` that silently skips the suite |
| `render-without-assertion` | warn | `render()` with no `expect()` within 25 lines (coverage theatre) |
| `missing-status-assert` | error | e2e API mutation not followed by a status assertion |

Used two ways: the `audit` CLI (also a CI gate, exit 1 on errors) and the **`audit_gate`** rune (can't finish with error-severity violations). See [Runes & Gates](Runes-and-Gates.md).

## Learning library (`src/library/`, `~/.local/share/probevane/`)

Mirrors qaforge's layout: append-only `index.jsonl` + per-example `<quality>/<stack>/<category>/<slug>.{md,meta.json}`.

- **`store.ts`** — save/read examples + index.
- **`retrieve.ts`** — few-shot selection, filtered by **stack + kind** (React examples never leak into Python), ranked by category match → score → recency.
- **`context_inject` rune** — at run start, injects the quality rules + the kind's pattern file (`prompts/unit-patterns.md`) + top-K worked examples.
- **`learn` CLI** — saves an accepted spec as a `good` example with an audit-derived score; `--bad` records a failure example.

### The flywheel
```
generate (gated) ──accepted──► learn ──► library
       ▲                                    │
       └──────── context_inject (few-shot) ◄┘
```
Each green run can enrich the library; the next run starts from a higher-quality prior. (P4 closes the loop further: `caveat_harvest` turns recurring failures into bad-examples + prompt patches.)
