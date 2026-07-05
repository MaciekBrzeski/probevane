# probevane

A unified, transferable agentic harness that **adds unit + e2e tests to a project** — plus feature, refactor, repair, and review task paths. It drives an LLM through a *gated loop*: the model can only finish once the tests it wrote are real, green, and clean.

## Quickstart

```sh
./bin/probevane init <dir>       # detect the stack, install test deps + config
./bin/probevane plan <dir>       # $0 read-only action plan: untested targets, gaps
./bin/probevane generate <dir>   # the gated loop writes unit tests
./bin/probevane generate <dir> --kind e2e   # ...or Playwright e2e tests
./bin/probevane run <dir>        # run the suite
./bin/probevane status <dir>     # dashboard
```

Node 22+. No build step needed — the CLI runs via `tsx` (compiled `dist/` is preferred when present). Full command reference: [docs/wiki/Commands.md](docs/wiki/Commands.md) (generated, drift-gated).

## The mental model

You point probevane at a project. An **adapter** detects the stack and knows how to install, probe, run, and measure tests for it. The **loop** asks a **brain** (an LLM) to read the code, plan, and write tests via a small tool surface. **Runes** gate the loop: `plan_first` forces a plan grounded in probed facts before any test is written; `validation_gate` refuses to let the run finish while typecheck or the suite is red; `audit_gate` blocks test anti-patterns; `acceptance_gate` enforces count + coverage floors. The model never guesses: adapters `probe()` ground truth first, and a failed probe is a hard block.

Supported stacks (each one folder under `src/adapters/`): **React** (vitest + Playwright, first-class), Python (pytest), Vue, Svelte, plain Node, Go, Rust, Angular.

## Correctness, not just well-formedness

Default gates measure well-formedness: suite green, no anti-patterns, minimum count, coverage %. The correctness floor — *does the suite actually catch bugs?* — is the **mutation gate**: `--strict` (or `strict: true` in `probevane.config.*`) injects sampled mutants and blocks acceptance until the suite kills enough of them, steering the model to strengthen weak assertions. Budget-capped and advisory on timeout, so it can never deadlock CI.

## Task paths

Beyond `generate`, the same gated loop runs `feature` (TDD: red first), `refactor`/`migrate` (characterization: `behavior_lock` treats existing tests as a contract), `repair`/`fix` (make red suites green without gutting them), `review` (LLM diff review with adversarial verification of findings), and `document`. `--worktree` runs any path in a throwaway git worktree; the live tree is untouched until `--worktree-review`/`--worktree-merge`.

## $0 modes

- `--model bridge` — the loop writes API-shaped requests to a file queue; any host (e.g. a Claude Code session) services them. Same gates, zero API cost.
- `--model replay:<cassette>` — deterministic playback of a recorded run (this is how path CI works offline).
- `--model ollama[:<id>]` / `local:<id>` — local/OpenAI-compatible endpoints.

## The harness tests itself

`fixtures/` holds small apps per stack; `npm run eval` scores each committed suite against a baseline (green, count, coverage, audit, flake, shadow-oracle) and appends to the append-only `eval/improvement-log.csv` — failures stay flagged, never deleted. CI dogfoods the whole chain: probevane grades its own source (`quality . --strict`), mutates its own tests (`mutation . --min-score`), and regenerates its own docs.

GitHub Action: `action.yml` runs `probevane ci` on PRs and comments changed-but-untested files + coverage delta.

## Docs

- [docs/wiki/Operations.md](docs/wiki/Operations.md) — **run it fresh** (install, build, secrets, env, isolation, security, verify)
- [docs/wiki/Home.md](docs/wiki/Home.md) — the wiki (`npm run wiki` serves it locally)
- [docs/probevane-guide.md](docs/probevane-guide.md) — long-form guide
- [docs/wiki/Phase-Log.md](docs/wiki/Phase-Log.md) — build record, honest negatives included

## License

MIT
