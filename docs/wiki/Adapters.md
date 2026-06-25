# Adapters

The `StackAdapter` interface (`src/adapters/adapter.ts`) is the modularity load-bearer. Everything language/framework-specific lives behind it; the loop, library, audit core, and eval are stack-agnostic.

## The contract

| Method | Purpose |
|---|---|
| `detect(dir)` → 0..1 | confidence this adapter owns the project; the registry picks the max |
| `install(dir)` | add test deps + config (idempotent) |
| `discover(dir, kind)` | find targets worth testing (components/modules/routes) |
| `probe(dir, target)` | gather **ground truth** before generation; failure ⇒ hard `plan_first` block |
| `unitGen(target, probe, ctx)` | produce unit specs (P2) |
| `e2eGen(target, probe, ctx)?` | produce e2e specs (P3); optional — a stack may do unit only |
| `run(dir, scope)` | execute suites → `{passed, failed, skipped, green}` |
| `coverage(dir)` | → `{statements, branches, functions, lines}` |
| `auditRules()` | language-specific audit rules fed to the audit core |
| `commands()` | the shell commands gates run (typecheck/lint/test/coverage) |

## react-vitest-playwright (first-class)

| Concern | How |
|---|---|
| detect | `package.json` has react (+0.5), vite/react-scripts (+0.3), plugin-react/ts (+0.2) |
| install | add vitest, @testing-library/react+user-event+jest-dom, jsdom, @playwright/test; write `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts` (only if missing) |
| run (unit) | `vitest run --reporter=json`, parse counts |
| run (e2e) | `playwright test --reporter=line`, parse counts |
| coverage | `vitest run --coverage` → `coverage-summary.json` |
| commands | typecheck `tsc --noEmit`, testUnit `vitest run`, … |
| auditRules | JS/TS rules in `src/audit/rules-js.ts` |

`probe`/`unitGen`/`e2eGen` are stubbed until P2/P3 — the stub returns `ok:false` so the loop treats a probe as a hard block rather than guessing.

## python-pytest (second first-class stack)

Implements the same contract: detect (`pyproject.toml`/`requirements.txt`/`.py`), install (pip), discover (`.py` modules), probe (def/class/raise extraction), run (JUnit-XML parse — reliable under any `-q`), coverage (`--cov` json), `specFiles` (`test_*.py`/`*_test.py`), `guidance`/`patternsDoc` (pytest), `rules-py` audit. Resolves an interpreter from `PROBEVANE_PY` → local `.venv` → `python3`.

Proven in P5: same loop/gates/brain generated 22 passing pytest tests from zero. Adding it surfaced 3 React-isms in the core that became adapter methods (ADR-007) — after that, a 3rd stack is a pure drop-in.

## specFiles / guidance / patternsDoc

These three contract methods are why the loop is stack-agnostic: what counts as a test file, the framework/placement instructions, and the few-shot patterns all come from the adapter, never the core.

## Adding a stack

1. Create `src/adapters/<id>/index.ts` implementing `StackAdapter`.
2. Add language audit rules under `src/audit/`.
3. Register it in `src/adapters/registry.ts`.

Nothing else changes. That is the whole point.
