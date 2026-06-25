# Eval & Fixtures

The harness must be *testable*. We apply fourier-nca discipline: each run is a measured **intervention** against a **control** (the fixture) compared to a **baseline**.

## Fixtures (`fixtures/`)

Self-contained, low-/zero-test apps the harness runs against.

| Fixture | Stack | Role |
|---|---|---|
| `react-todo` | React + Vite + TS | golden fixture; pure helpers + a DOM component |
| `react-forms` | React | richer interactions (P4) |
| `py-calc` | Python | cross-language proof (P5) |

`react-todo/src/App.tsx` exposes pure helpers (`addTodo`, `toggleTodo`, `removeTodo`, `remaining`) and a `<App/>` component — easy unit + e2e targets.

## Eval (`eval/`)

- `cases.jsonl` — one line per case: `{fixture, kind, expectMinTests?, expectMinCoverage?}`.
- `improvement-log.csv` — **append-only** metrics. Columns: `timestamp,target,kind,pass,audit_score,tests,coverage,flake,library_good,library_bad,note`.
- `baseline/` — committed expected metrics + a shadow-oracle spec (P4).
- `runner.ts` / `scorer.ts` — full generate→run→audit→flake scoring (P4). P0/P1 `eval` just runs each fixture and records a baseline row.

## What gets measured (P4)

| Metric | Meaning |
|---|---|
| generation pass-rate | fraction of cases reaching an all-gates-green accept |
| audit score (0..5) | mean static-quality score |
| coverage delta | coverage after − before (fresh project: from 0) |
| flake | fraction of N=3 re-runs whose pass/fail set differs |

**Shadow-oracle:** a hand-written known-good spec in `baseline/`; the generated spec must cover at least its assertions — a cheap correctness check independent of the LLM.

**Honest negatives:** cases the harness fails stay flagged in `cases.jsonl`, never deleted.

## CI (P4)

`.github/workflows/eval.yml` runs `eval` on each PR with a record/replay brain, asserts **no regression** vs `baseline/`, and appends to the improvement-log. Live (real-LLM) evals run nightly.

## Run it

```
probevane eval          # all cases, append a log row
```
