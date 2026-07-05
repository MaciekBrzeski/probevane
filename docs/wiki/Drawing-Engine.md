# Drawing Engine (facet)

probevane renders the same control center **twice** — the browser dashboard (SVG/DOM) and `probevane tui` (a terminal cell grid). For a long time both were built by hand and drifted: a gauge, a node-graph edge, a panel background each took two passes and two bug fixes, one per medium. **facet** ends that: a dual-target 2D drawing engine where every widget is authored **once** against an abstract `Painter` and rasterized by two backends. It lives in-repo at [`engine/`](../../engine) as internal npm-workspace packages, so probevane still ships as **one self-contained package**.

> One vector `Painter`, two backends: crisp **SVG** (browser) + **braille/box cells** (terminal). Author a widget once; both media render it.

## Why an engine at all

The terminal stack was *already* backend-agnostic up to the codec — `Screen`/`Cell`/`Style` emit zero ANSI; only `serialize`/`diff` are terminal-specific, and `Style.fg/bg` is the same packed `0xRRGGBB` the browser theme uses. The three browser graphical widgets (node-graph, gauge, spark) were pure SVG geometry whose *layout* already came from shared pure modules (`layoutDag`, the constellation builder). So the model was already shared; only the **drawing** was duplicated. Extracting a `Painter` seam collapsed the duplication into one authoring surface without giving up either medium's strengths — SVG stays crisp vectors, the terminal keeps its hand-tuned box-drawing and gains braille subpixel curves.

## The three packages

| Package | Role |
|---|---|
| [`engine/core`](../../engine/core) (`@facet/core`) | Pure, no DOM/ANSI. The `Painter` interface + `Caps`, `Style` (packed colour + colour/anim math: `mix`/`glow`/`pulse`), geometry + span math, the layered-DAG `layoutDag`, and **all 44 widgets**. |
| [`engine/render-term`](../../engine/render-term) (`@facet/render-term`) | `CellPainter` — rasterizes vectors into a cell `Screen`: axis-aligned → box-drawing, curves/diagonals → **braille** 2×4 subpixels, text → clipped writes. Plus the `Screen` surface + ANSI codec (`serialize`/`diff`, truecolor + 256-colour fallback). |
| [`engine/render-dom`](../../engine/render-dom) (`@facet/render-dom`) | `SvgPainter` — a DOM-free SVG **string** builder (node-testable), honouring SVG-hint `Style` fields (tag→class, `pathLength`, gradients) so a browser consumer keeps its CSS animation when it adopts a widget. |

### The `Painter` contract

Immediate-mode, float world-coords: `rect · line · polyline · polygon · arc · text · push/pop` transform, plus **`caps`** — `{ subpixel, curves, glyphGrid, cellW, cellH }`. `caps` is the *one* place a widget may branch on medium, and the branches are few and documented as the honest gaps (e.g. a gauge draws an arc where subpixel curves exist, a bar where they don't). Everything else is medium-blind: the widget draws vectors, each backend decides how.

### The aspect twist (why the terminal gauge is round)

A terminal cell is ~**1:2** (wide:tall), so an equal-radius arc rasterizes to a tall egg — the browser, with square pixels, draws it round. The fix lives in the **backend**, not the widget: `CellPainter.arc` passes a `yScale ≈ 0.5` to the braille rasterizer, squashing the vertical radius so a circle *looks* round in cells while SVG stays round independently. Author-once is preserved — `gauge` and `donut` just call `arc(r)`; each backend makes it look right. This is the model for every medium gap: the widget stays honest, the backend compensates.

## The 44 widgets

One definition each, both backends, grouped as a browser component library (MUI/Material breadth). Interactive controls are **static visual states** — `checked`/`focused`/`value`/`open` are props, not behaviour (exactly how a component catalog shows them).

| Group | Widgets |
|---|---|
| layout | `frame` |
| data | `gauge` · `sparkline` · `progress` · `nodeGraph` |
| charts | `barChart` · `donut` · `heatmap` · `legend` · `meter` |
| controls | `button` · `badge` · `spinner` · `buttonGroup` · `rating` |
| inputs | `checkbox` · `radio` · `toggle` · `slider` · `textField` · `select` |
| feedback | `alert` · `banner` · `tooltip` · `dialog` · `skeleton` · `emptyState` |
| display | `avatar` · `chip` · `card` · `divider` · `stat` · `accordion` · `tree` · `timeline` · `scrollbar` |
| navigation | `breadcrumb` · `pagination` · `stepper` · `menu` |
| collections | `list` · `table` · `keyValue` |
| nav | `tabs` |

Text-composed widgets (lists, tables, breadcrumbs, stats) render **byte-identical** across backends because they only call `text`; geometric ones (gauge, donut, sparkline, the framed boxes) rasterize per medium. What's *excluded* is honest and unchanged: layout primitives (the caller positions absolutely via `spanToBox`/`layoutDag`), compositor-dependent overlays (Backdrop/Drawer/portal Modal — `dialog` approximates), interaction-only widgets (Autocomplete, date-picker — a static-state model can't show the behaviour), and icon sets.

## The catalog + the storybook

The library ships its own two-format showcase, both dogfooding the engine:

- **HTML catalog** — [`engine/gallery`](../../engine/gallery) `npm run -w @facet/gallery build` → `dist/gallery.html`: every widget rendered side-by-side in **both** backends (SVG + a cell grid painted to HTML spans) with a copy-paste usage snippet, grouped by category.
- **In-terminal storybook** — `npm run -w @facet/gallery storybook`: a browsable tty catalog — left rail of components, detail pane with a live cell preview + usage, ↑↓/jk to navigate, an animated spinner driven by the tick. The chrome itself is drawn with facet's own `frame`/`list` widgets, and the rail **windows** around the selection so all 44 stay reachable in any terminal height.

## How probevane consumes it

Imports are `@facet/*` everywhere (resolved to the workspace) — the same components draw the terminal *and* the browser:

- **`src/tui/*`** — the terminal control center. A thin bridge (`src/tui/facet.ts` `paintWidget`) runs a widget on a `CellPainter` sized to a pane rect and blits it into the `Screen`. Live surfaces: **Projects** (a `card` grid with a run-count `badge` + accept-rate `progress`), **Launch** (a `menu` panel), the **Console** hero (`stat` blocks + a run-phase `stepper` + a recent-runs `timeline` in the pipeline pane's lower half), **Cost** (a daily-cost `barChart` + an acceptance `donut` + `legend`), and `emptyState` for empty panes.
- **`src/ui/app/*`** — the browser dashboard's graphical widgets draw through `SvgPainter`; `build-ui.mjs` inlines the shared engine source (provenance comments point at `engine/`).

## Shipping as one package

facet is a `file:`-free in-repo workspace, but its package `main` points at TypeScript source with extensionless imports (fine for tsx/bundlers, **unrunnable by plain node**). The build (`scripts/build.mjs`) esbuild-bundles each package to standalone JS under `dist/node_modules/@facet/*`; node resolves *that* copy first (it's nearer `dist/cli/*.js` than the repo's node_modules), so the compiled dist — and `npm pack` — run clean. This retired the "dist broken with facet file-deps" debt that once crashed `probevane tui` with `ERR_MODULE_NOT_FOUND`, and it's now smoke-gated (see below).

## Gates

The engine is itself tested — `npm run engine:gate` (first step in CI) and its own [`engine` CI workflow](../../engine):

- **lint** ([`engine/lint.mjs`](../../engine/lint.mjs)) — bloat only: files ≤300 lines, functions ≤60. facet's one-line-widget idiom is deliberate, so line width is advisory, not a failure.
- **typecheck** — every package.
- **parity-44** — the oracle over the *whole* catalog: each widget must render non-empty in both backends **and** agree on its text labels. Catches a widget that silently no-ops in one medium or drifts a label between SVG and cells (was gauge + node-graph only before).
- **snapshot-88** — a deterministic cell-grid + SVG-string snapshot per widget. A rendering change (the gauge egg, a garbled stepper, SVG typography) shows up as a snapshot diff instead of needing a screenshot.
- **UI perf** ([`scripts/bench-ui.mjs`](../../scripts/bench-ui.mjs), probevane CI) — render budgets. The machine-independent signals are the real ones: a 1-cell change diff-flushes **≤3% of a full repaint** (measured 0.2% — this is what makes the terminal flicker-free), and `control.html` stays **≤80 kB** (64.3). Timing budgets (frame build, 44-widget render <15 ms; measured ~0.2 ms) are coarse backstops for a catastrophic regression, never a slow CI runner.

## See also

- [Control Center](Control-Center.md) — the dashboard + `probevane tui` that consume the engine.
- [Architecture](Architecture.md) — where the engine sits among the subsystems.
- [Decisions (ADR)](Decisions.md) — ADR-016 (the engine), ADR-017 (vendoring), ADR-018 (the new gates).
