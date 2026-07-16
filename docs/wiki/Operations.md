# Operations — run probevane in a fresh / isolated / production environment

A handoff runbook: clone → install → build → configure secrets → run, plus the environment reference, isolation model, and security posture. probevane is ESM TypeScript (Node 22+); it ships as **one self-contained package** (the `@facet/*` drawing engine is vendored under [`engine/`](../../engine) and bundled into `dist/`), so a lone checkout builds and runs with no sibling repos.

## 1. Prerequisites

- **Node ≥ 22** and **git**. That's all probevane itself needs (`package.json` deps are just `@anthropic-ai/sdk` + `ts-morph`; the engine is in-repo).
- **A model brain** (pick one — see §4). The default needs `ANTHROPIC_API_KEY`; the `$0` modes need an ollama key or nothing.
- **Per-stack toolchains** — only needed to *generate/run tests for a target project* in that stack, not to run probevane:
  - React/Vue/Svelte/Angular/Node → the target's own `npm install` (probevane installs its test deps).
  - e2e generation → Playwright browsers: `npx playwright install --with-deps chromium`.
  - Python target → `python3` + `pip install pytest pytest-cov` (the adapter also bootstraps a project-local `.venv`).
  - Go / Rust target → `go` / `cargo` on PATH.
- **Nothing global to install for probevane** — run it from the checkout via `bin/probevane`.

## 2. Install

```sh
git clone <repo> probevane && cd probevane
npm install          # installs deps + links the engine/* workspaces
```

`npm ci` also works (there's a lockfile). The `engine/{core,render-term,render-dom,gallery}` workspaces link automatically (`node_modules/@facet/*` → `engine/*`).

## 3. Build for production

Dev-from-checkout runs the TypeScript directly via `tsx` — no build needed. For a **deployable / no-tsx** install, build the compiled `dist/`:

```sh
npm run build                 # tsc → dist/ + copies ui assets + esbuild-bundles the engine
node scripts/smoke-dist.mjs   # verify dist actually RUNS (not just compiles)
```

`bin/probevane` prefers `dist/cli/<cmd>.js` (plain `node`, no tsx) when present, and falls back to `tsx src/` otherwise. `npm pack` produces a self-contained tarball (dist + the bundled engine under `dist/node_modules/@facet/*`), so `npm install`-ing the package elsewhere runs clean.

## 4. Model brains + secrets

Select with `--model` (flag) or `model:` in the target's `probevane.config.*`. Precedence: flag > config > default.

| `--model` | Backend | Secret needed |
|---|---|---|
| *(default)* | Anthropic SDK | **`ANTHROPIC_API_KEY`** |
| `ollama` / `ollama:<id>` | ollama.com cloud (default `kimi-k2.7-code`) | `~/.config/probevane/ollama.key` (or `PROBEVANE_OLLAMA_KEY_FILE`, or `PROBEVANE_API_KEY`) |
| `bridge` | `$0` — writes API-shaped requests to `<state>/bridge/`, an external Claude Code session answers | **none** |
| `claude-code` / `cc:<id>` | spawns the local `claude` CLI | a working `claude` install |
| `local:<id>` / `openai:<id>` | any OpenAI-compatible endpoint (`PROBEVANE_BASE_URL`) | that endpoint's key (`OPENAI_API_KEY`) |
| `replay:<cassette>` | deterministic offline replay | none |

Other integrations: the `arch` critique uses an ollama model (`PROBEVANE_ARCH_KEY` / the ollama key); the `ado` command reads `~/.config/probevane/ado.pat` or `AZURE_DEVOPS_PAT` (+ `AZURE_DEVOPS_ORG`/`_PROJECT`). None are required for core test generation.

## 5. State + isolation (read this before running more than one)

All persistent state — the cross-project library, the `runs.jsonl` ledger, the bridge queue, the model pointer, launched-job records — lives under one **state root**:

```
PROBEVANE_STATE  ??  ~/.local/share/probevane
```

**Every concurrent, factory, bridge, or production instance MUST set its own `PROBEVANE_STATE`** so ledgers, traces, and bridge queues never collide:

```sh
PROBEVANE_STATE=/var/lib/probevane/inst-a  probevane daemon --port 7766
PROBEVANE_STATE=/var/lib/probevane/inst-b  probevane daemon --port 7767
```

Per-run logs (events + transcript jsonl) are written under `<target-dir>/.probevane/`, not the state root. Target config is `probevane.config.{ts,js,mjs,json}` in the **target** project dir, schema-validated.

## 6. Running

**One-shot CLI** (against a target project):

```sh
probevane generate <dir>                 # add unit tests (default)
probevane generate <dir> --kind e2e      # Playwright e2e
probevane refactor|feature|repair|document <dir> --task "…"
probevane <cmd> --help                   # per-command help (drift-gated catalog)
```

**Daemon / control center** — the LCARS dashboard + queue + observability:

```sh
probevane daemon --port 7766             # http://127.0.0.1:7766 (binds loopback only)
```

**Supervisor (lights-out production)** — pull work from a queue and dispatch, optionally ship on accept:

```sh
PROBEVANE_QUEUE=1 PROBEVANE_SHIP=1 PROBEVANE_STATE=/var/lib/probevane/prod \
  probevane daemon --port 7766 --interval 30
```

It pulls `<state>/queue.jsonl` on each tick, runs accepted work, persists jobs to `jobs.jsonl` (restart-safe), re-evaluates alerts, and (with `PROBEVANE_SHIP=1`) opens a PR on accept. Enqueue with `probevane enqueue …` or `POST /enqueue`.

**Terminal UI** (no browser): `probevane tui` — auto-spawns the daemon if none is up.

## 7. Environment reference

Set only what you use. Full surface is `PROBEVANE_*` (grep the source); the ones that matter operationally:

| Var | Effect |
|---|---|
| `PROBEVANE_STATE` | state root (isolation) — **set per instance** |
| `ANTHROPIC_API_KEY` | default brain key |
| `PROBEVANE_OLLAMA_KEY_FILE` / `PROBEVANE_API_KEY` | ollama / `$0`-arch key |
| `PROBEVANE_DAEMON_PORT` | daemon port (or `--port`; default 7766) |
| `PROBEVANE_QUEUE=1` | daemon becomes a supervisor (pulls the queue) |
| `PROBEVANE_SHIP=1` | supervisor opens a PR on accept |
| `PROBEVANE_TERMINAL=1` | arm the daemon's Terminal tab (a live shell — see §8) |
| `PROBEVANE_UI_DEV=1` | recompile the control-center TSX per request (dev) |
| `PROBEVANE_BASE_URL` | OpenAI-compatible endpoint for `local:`/`openai:` |
| `PROBEVANE_RECORD` / `replay:` | record / replay cassettes (`$0` deterministic) |
| `AZURE_DEVOPS_PAT` / `_ORG` / `_PROJECT` | the `ado` integration |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ship traces/metrics to an OTLP collector |

## 8. Security posture

- **Loopback only.** The daemon binds `127.0.0.1`; that bind is the *only* auth. **Never** port-forward it without an SSH tunnel — anyone who reaches the port controls it.
- **Terminal tab is off by default.** `PROBEVANE_TERMINAL=1` arms a live browser shell over a PTY; it deliberately **bypasses** the launch allowlist (a shell is a shell), which is why it's opt-in. `/term/*` returns 403 when unarmed. Every session start/exit is logged with full argv.
- **Ledgers are read-only over HTTP.** `ship`/PR flows never touch the default branch; runs commit only their own edited files.
- **Secrets are files or env**, never in the repo — key files live under `~/.config/probevane/`.

## 9. Verify your setup

```sh
npm run build && node scripts/smoke-dist.mjs   # dist compiles AND runs
probevane doctor <target-dir> --full           # 12-check environment/health scorecard
npm test                                       # the harness's own suite (dogfood)
```

`doctor` catches the common fresh-environment problems (missing toolchain, uninstalled browsers, invalid config, missing keys, stale artifacts). For a full self-check, the CI sequence in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) is the exhaustive gate (typecheck → engine gate → coverage → dist build + smoke → ui perf → drift gates → quality → mutation → e2e → eval).

## 10. Periodic maintenance (not in CI)

Some quality signals need a human cadence — they cost minutes, need a local model, or are advisory. Run them on a maintenance cadence, not per-commit:

```sh
probevane arch . --pyramid                     # structural drift: pyramid score + crowding + role-violation report
probevane arch . --snapshot                    # commit docs/arch-snapshot.json → coupling regressions become diffs
probevane search . --similar --fns             # function-level merge candidates by doc-comment similarity (needs local ollama embed)
probevane mutation . --budget 200              # correctness sample → writes .probevane/mutation-report.json for the Checks tab
probevane distill stats                        # trace-dataset inventory per stack (fine-tune readiness)
```

- **Doc-similarity** (`--similar --fns`) needs a local ollama embedding endpoint (`PROBEVANE_EMBED_URL`); it can't run in CI, so it's the periodic way to find the next consolidation batch (the walk-family paydown came from it).
- **Distill**: the trace dataset currently skews one stack (node-vitest dominant); a balanced LoRA run wants more per-stack traces first. When ready, the training entrypoint is `scripts/train_lora.py` over the `distill build` dataset, promoted via `<state>/model.json` — see the `distill` subsystem in [Architecture](Architecture.md).
- **Vane / skill drift** (`probevane vane --check`, `probevane skill --check`) DO run in CI — listed under §9's full sequence, not here.

## See also

- [Home](Home.md) · [Control Center](Control-Center.md) (the daemon dashboard + `tui`) · [Commands](Commands.md) (full CLI, generated) · [Architecture](Architecture.md) · [Drawing Engine](Drawing-Engine.md) (the vendored `engine/`).
