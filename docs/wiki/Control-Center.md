# Control Center

The daemon's web UI — an LCARS-styled console over the whole fleet: projects, run history, live runs, docs, launching, cost/alerts, source quality, and the **Console** tab's node graphs.

## Start it

```sh
./bin/probevane daemon --port 7766            # → http://127.0.0.1:7766/
PROBEVANE_UI_DEV=1 ./bin/probevane daemon …   # dev: runtime compiler (see below)
PROBEVANE_QUEUE=1  ./bin/probevane daemon …   # lights-out supervisor mode
PROBEVANE_TERMINAL=1 ./bin/probevane daemon … # arm the Terminal tab (see below)
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
| Terminal | a live shell in the browser (opt-in) — see below |

## The Console

- **Run pipeline** — the write_tests rune chain as glowing capsules (derived live from `/pipeline` → `describePipeline`, never a stale model). During a watched run the event stream drives it: a blocking gate **flashes red**, the next productive tool call cools it to active, an accept **cascades every rune green**, a terminal failure leaves the blockers red.
- **Telemetry** — acceptance/run-volume ring gauges + glow sparklines (cost/day, tokens/day) from `/aggregate`.
- **Module constellation** — the project dependency graph (`/graph` → `buildGraph`), top fan-in hubs filtered to the connected subgraph; hub weight = fan-in, red = calls the network.

### Theater — replay any captured run

Every run writes a **durable event stream** to `<state>/events/<runId>.jsonl` (workdir copies die with eval/live temp dirs; this one survives). Runs tab → open a run → **replay show ▶** plays it through the console at compressed original cadence — no loop, no model, $0. Runs recorded before the feature 404 politely.

## The Terminal tab (opt-in)

Run `claude` — or any agentic CLI — **inside the console**, next to the live pipeline. `PROBEVANE_TERMINAL=1` arms it; without the env the `/term/*` routes return `403` and the tab shows the opt-in hint. Presets spawn `$SHELL`/`bash`/`claude`; xterm renders full ANSI + a real cursor, resize is wired (fit addon → `TIOCSWINSZ`), and a session reattaches after a page reload.

**How it works.** No node-pty (that's a native module — it would break the two-runtime-dep invariant). Instead `scripts/pty-bridge.py` (stdlib `pty.fork` + a select loop) allocates the tty; the daemon streams its raw output down over SSE as base64 frames (`/term/stream`) and forwards keystrokes/resize/kill up via POST (`/term/input`, `/term/resize`, `/term/kill`). xterm.js is a CDN `<script>` like marked/mermaid. Sessions: 4 max, 512 KB scrollback each, 30-min idle reap (all `PROBEVANE_TERM_*` overridable). Output is glyph-rendered by xterm — never innerHTML — so a malicious escape sequence can't inject DOM.

> ⚠️ **Security.** The terminal is a shell — it deliberately bypasses the `LAUNCH_OPS` allowlist, which is exactly why it's opt-in. The only auth is the 127.0.0.1 bind: **anyone who can reach the port owns your shell.** Never port-forward the daemon without an SSH tunnel. Every session start/exit is logged with its full argv (`term_start`/`term_exit`) to `daemon.log.jsonl`.

## `probevane tui` — the control center in the terminal

Prefer a terminal? `probevane tui` is the whole command center without a browser:

```sh
probevane tui                 # auto-launches the daemon if it isn't up, then renders
probevane tui --port 7766     # target a specific daemon; --root for a state dir
```

It **auto-spawns the daemon** (probes `/health`; on refusal launches a detached `probevane daemon` and waits ≤10s), then paints a **tabbed LCARS console** on a **diff-flushed screen** (only changed cells emit ANSI, so no flicker):

| Tab | Panes |
|---|---|
| **Console** | rune-pipeline light-show (active lamps **pulse**) + telemetry bar-gauges (accept % / run volume, **sweep-in** on entry) + cost sparkline |
| **Runs** | active jobs + recent-run list (selectable) + alerts |
| **Signals** | cost/day sparkline + alerts + telemetry gauges |

A **frame clock** drives ambient motion (an 80 ms tick); because the runtime diff-flushes, an idle screen still only emits the handful of cells whose colour actually changed. Replaying a run auto-switches to **Console** so you watch the light-show where it lives.

**Full tab parity** — the terminal now renders **every** browser tab, from the shared `TABS` model: Projects, Runs, Docs, Launch, Cost/Alerts, Quality, Console, Terminal. Each is a manifest-driven layout (`LAYOUTS` → `layoutFor`): Projects = ranked project list; Docs = wiki page list + selected page body (fetched from `/wiki/raw/*`); Launch = op list + how-to (press `l`); Quality = per-file scorecard from `/quality`; Terminal = drop-to-shell hint (press `s`). Content fidelity is per-medium (e.g. Docs renders raw markdown text, not rendered HTML), but the tab set + layout regions are 1:1.

Keys: `q` quit · `⇥` next tab · `1`–`8` jump to a tab · `r` refresh · `l` **launch** · `s` shell · `↑↓` select (a run on Runs, a wiki page on Docs) · `enter`/**click** replay a run's light show. **Mouse**: click a tab to switch, click a run row to select, click it again (or `enter`) to replay; wheel scrolls the selection. Ctrl-C restores the terminal.

**Launch bar** (`l`): type a command. A probevane op (`generate`, `feature`, `repair`, `fix`, `quality`, …) is sent to the **daemon** (POST /run) so it appears in the Jobs pane with a **live light-show**; anything else (`claude`, `aider`, another harness) runs through your shell — the TUI suspends, the child owns the tty, and you're back when it exits. So the terminal command center both drives runs and watches them.

It's a pure HTTP client of the same daemon the browser uses, and shares its internals: the **layered-DAG layout** and the **light-show state machine** (`src/observe/pipeline.ts` `pipelineReducer`) are the exact code the browser console runs — one machine, two renderers (SVG in the browser, ANSI in the terminal). The render "runtime" is a tiny cell-grid + diff (`src/tui/screen.ts`) — the terminal analog of the browser's `h()`; panes are pure functions painting into a screen (`src/tui/views.ts`), unit-tested by serializing the screen and asserting substrings.

**LCARS styling.** The panes wear the same skin as the browser console. Colors are the **literal `control.css` hexes** (`--acc #4fd6ff`, `--warn #ffb454`, `--mag #c792ea`, …): `sgr()` emits 24-bit truecolor (`\x1b[38;2;r;g;b`) when the terminal advertises `COLORTERM=truecolor|24bit`, and falls back to the nearest 256-color cube otherwise (`38;5;n`) — still far closer than the old 8-color codes. Panels are `lcarsFrame` (`src/tui/frame.ts`): rounded corners (`╭╮╰╯`), a thick accent **left-rail** (`▉`), an **elbow** nub, and a **letter-spaced uppercase title** — the terminal read of the browser's `ScanFrame`.

Honest tty gaps (physics, not laziness): the browser's glow/drop-shadow → bold + bright color; gradient fills / vignette / scanline → one solid color per cell; ring-gauge arcs + Bézier graph edges → deferred (not in the terminal); sub-cell / asymmetric corner radius → single rounded glyphs. On a light-background terminal the panels sit on your terminal's default field (no forced `--bg` fill), so the palette reads best on a dark terminal.

The shell drop closes the loop the whole console is about: run the harness (or `claude`) in the embedded shell, then watch the run appear and replay its light show — a terminal command center that both observes and drives the loop.

## One model, two renderers (SSOT)

The browser and terminal control centers are **thin adapters over one shared model**, `src/ui/theme.ts`. Edit it once, both repaint:

| Model export | Browser adapter | Terminal adapter |
|---|---|---|
| `PALETTE` (hexes) | `main.tsx` sets `:root` custom-props via `cssVars()` at boot (CSS hardcodes none) | `draw.ts FG` = `packed()` per colour → truecolor SGR |
| `TABS` (id/title/accent) | `Tabs.tsx` maps them to the tab strip | `tabs.ts` renders `TERMINAL_TABS` (the supported subset: console/runs/cost) |
| `gauges(totals)` | `console.tsx` → `<Gauge>` SVG rings | `views.ts gaugePane` → ANSI bracket bars |
| `LAYOUTS` (per-tab span manifests) | `ConsolePanel.tsx` positions console panes via `spanToCss` | `screens.ts layoutFor` builds every tab's cell rects via `spanToBox` |
| `RUN_COLUMNS` (run-list schema) | `RunsPanel`/`RunRow` `<table>` cells | `views.ts jobsPane` aligned text columns (`table.ts` fits/sheds on narrow widths) |
| `constellation(nodes)` (`src/observe/`) | SVG `NodeGraph` | animated node graph (`graph.ts`) — pills + orthogonal box-drawing traces + a flowing signal dot; hub list on tiny panes |

Every terminal tab lays out through **one** manifest-driven pass (`layoutFor` → `spanToBox`); no hand-rolled per-tab math. The run list shows the **same columns** in both (when · label · model · status · cost · steps) — a real `<table>` in the browser, aligned text in the terminal (columns shed right-to-left when the pane is too narrow).

So the Console layout is **1:1 by construction** — the same fractional spans drive the browser's absolute-positioned panes and the terminal's cell rects. Palette/tabs/gauges are literally the same values.

Honest medium gaps (documented, not hidden): the module constellation is an SVG `NodeGraph` in the browser and a cell-grid node graph in the terminal — same `layoutDag` layering, capped to ~8 hubs, node pills wired by **orthogonal box-drawing traces** (each edge in its own vertical channel, crossings merged to ┼ so nothing reads as a false turn) with one bright signal dot flowing each trace from the frame clock; degrades to a ranked hub list when the pane is too small. Ring gauges → bracket bars; glow/gradient → bold + bright colour. The *regions, order, accents, titles, and values* match; only the per-pane content fidelity differs where the tty can't follow.

## How the UI is built

`src/ui/control.html` is **GENERATED** — never hand-edit it. Sources live in `src/ui/app/`:

- **TSX without a framework** — `src/ui/runtime.ts` is a ~40-line `h()`/`Fragment` producing real DOM nodes; string children go through `createTextNode` (the XSS posture is structural — proven by the e2e payload spec).
- **Convention over imports** — `<RunCard/>` resolves to `components/RunCard.tsx` by name. Nobody writes component imports: the esbuild plugin injects them, a missing file is a **compile error**, filename must equal the exported name (bijection check), and a local named `h`/`Fragment` fails the build (it would shadow the JSX factory). tsc type-checks the raw sources via generated `auto-imports.d.ts`.
- **Build + drift gate** — `node scripts/build-ui.mjs` bundles and inlines into `control.html`; `--check` is the CI drift gate (same pattern as SKILL.md).
- **Runtime compiler** — under `PROBEVANE_UI_DEV` the daemon recompiles the TSX sources per request (~20ms in-process esbuild): edit a component, refresh, see it. This is also what makes the `design` loop live: each CSS rewrite lands on the next screenshot with no rebuild step.
- **Design loop, gated** — `probevane design` accepts the raw `control.css` as target; its **selector-preservation gate** discards any model rewrite that drops a selector (instructions requested, contracts enforced — a rewrite once dropped 66 selectors and was auto-reverted).

Layout for the node graphs is a pure, unit-tested layered-DAG pass (`src/ui/app/layout.ts`) — longest-path layering + barycenter rows, no physics dependencies.
