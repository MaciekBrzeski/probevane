# CLI

`./bin/probevane <cmd> <dir>` — a bash dispatcher to `src/cli/<cmd>.ts` via `tsx` (no build step). Node 22+.

| Command | Status | What it does |
|---|---|---|
| `init <dir>` | ✅ | detect stack, install test deps + config (idempotent) |
| `run <dir> [--scope unit\|e2e\|all]` | ✅ | run suites via the detected adapter |
| `coverage <dir>` | ✅ | read coverage |
| `status <dir>` | ✅ | quick dashboard (adapter, run, coverage) |
| `eval` | ✅ | run the eval suite over fixtures, append the improvement-log |
| `generate <dir> [--kind unit\|e2e] [--model auto\|haiku\|sonnet\|opus] [--mock] [--mutation] [--spec] [--max-steps N] [--max-targets N] [--min-tests N] [--min-coverage P]` | ✅ | probe-grounded gated loop writes tests; `--model auto` routes complex code to a stronger model |
| `audit <dir>` | ✅ (P2) | static quality gate over specs (exit 1 on errors) |
| `learn <dir> --file <spec> --category <c> [--kind] [--bad]` | ✅ (P2) | save a spec to the cross-project learning library |
| `mock <dir>` | ✅ | synthesize the mock boundary + fixtures + contracts (no LLM) |
| `graph <dir> [--mermaid <file>]` | ✅ | render the module dependency graph (ASCII + Mermaid) |
| `spec <dir> [--narrate] [--out <file>] [--wiki]` | ✅ | generate `SPEC.md` (graph, modules, API surface, coverage); `--narrate` adds LLM descriptions; `--wiki` publishes to the wiki Projects section |
| `plan <dir>` | ⏳ | probe + emit a grounded test plan (no edits) |

## Examples

```bash
# P0 — run the shipped tests + see coverage
./bin/probevane run fixtures/react-todo --scope unit
./bin/probevane coverage fixtures/react-todo
./bin/probevane status fixtures/react-todo

# P1 — generate unit tests with the gated loop (needs ANTHROPIC_API_KEY)
./bin/probevane generate <some-react-project> --kind unit --max-steps 12

# the harness's own eval
./bin/probevane eval
```

## Env

| Var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | required for `generate` (the brain) |
| `PROBEVANE_MODEL` | override the brain model (default `claude-haiku-4-5-20251001`) |

## Wiki

```bash
npm run wiki        # serve this wiki at http://localhost:4173
```
