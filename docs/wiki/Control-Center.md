# Control Center

The daemon's web UI — an LCARS-styled console over the whole fleet: projects, run history, live runs, docs, launching, cost/alerts, source quality, and the **Console** tab's node graphs.

## Start it

```sh
./bin/probevane daemon --port 7766            # → http://127.0.0.1:7766/
PROBEVANE_UI_DEV=1 ./bin/probevane daemon …   # dev: runtime compiler (see below)
PROBEVANE_QUEUE=1  ./bin/probevane daemon …   # lights-out supervisor mode
```

Binds 127.0.0.1 only. `--root <stateDir>` points it at a different ledger root.

## Tabs

| Tab | What it shows |
|---|---|
| Projects | one card per `probevane spec --wiki` project, run counts + last outcome |
| Runs | active jobs (watch ▶ opens the live drawer) + full run history; a run's drawer has timeline, transcript, and **replay show ▶** |
| Docs | the wiki, rendered in-app (marked + mermaid, `securityLevel: strict`) |
| Launch | dir + op + flags → POST /run; flags are quote-aware (`--task "add multiply()"`) |
| Cost / Alerts | daily cost bars, alert list, library audit trail |
| Quality | on-demand `quality` scan of any dir |
| Console | the Trek panel — see below |

## The Console

- **Run pipeline** — the write_tests rune chain as glowing capsules (derived live from `/pipeline` → `describePipeline`, never a stale model). During a watched run the event stream drives it: a blocking gate **flashes red**, the next productive tool call cools it to active, an accept **cascades every rune green**, a terminal failure leaves the blockers red.
- **Telemetry** — acceptance/run-volume ring gauges + glow sparklines (cost/day, tokens/day) from `/aggregate`.
- **Module constellation** — the project dependency graph (`/graph` → `buildGraph`), top fan-in hubs filtered to the connected subgraph; hub weight = fan-in, red = calls the network.

### Theater — replay any captured run

Every run writes a **durable event stream** to `<state>/events/<runId>.jsonl` (workdir copies die with eval/live temp dirs; this one survives). Runs tab → open a run → **replay show ▶** plays it through the console at compressed original cadence — no loop, no model, $0. Runs recorded before the feature 404 politely.

## How the UI is built

`src/ui/control.html` is **GENERATED** — never hand-edit it. Sources live in `src/ui/app/`:

- **TSX without a framework** — `src/ui/runtime.ts` is a ~40-line `h()`/`Fragment` producing real DOM nodes; string children go through `createTextNode` (the XSS posture is structural — proven by the e2e payload spec).
- **Convention over imports** — `<RunCard/>` resolves to `components/RunCard.tsx` by name. Nobody writes component imports: the esbuild plugin injects them, a missing file is a **compile error**, filename must equal the exported name (bijection check), and a local named `h`/`Fragment` fails the build (it would shadow the JSX factory). tsc type-checks the raw sources via generated `auto-imports.d.ts`.
- **Build + drift gate** — `node scripts/build-ui.mjs` bundles and inlines into `control.html`; `--check` is the CI drift gate (same pattern as SKILL.md).
- **Runtime compiler** — under `PROBEVANE_UI_DEV` the daemon recompiles the TSX sources per request (~20ms in-process esbuild): edit a component, refresh, see it. This is also what makes the `design` loop live: each CSS rewrite lands on the next screenshot with no rebuild step.
- **Design loop, gated** — `probevane design` accepts the raw `control.css` as target; its **selector-preservation gate** discards any model rewrite that drops a selector (instructions requested, contracts enforced — a rewrite once dropped 66 selectors and was auto-reverted).

Layout for the node graphs is a pure, unit-tested layered-DAG pass (`src/ui/app/layout.ts`) — longest-path layering + barycenter rows, no physics dependencies.
