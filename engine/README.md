# engine/ — facet drawing engine (vendored)

**facet** — a dual-target 2D drawing engine. One vector `Painter` API, two backends: crisp SVG (browser) + braille/box cells (terminal). Every widget is authored **once** against `Painter` and rendered by both.

Vendored into probevane as internal npm-workspace packages so probevane ships as **one self-contained package** (no external dependency; `bin/probevane` + `dist/` bundle it). Originally developed as a standalone repo (`~/Dokumenty/facet`, archived `facet-archive-2026-07-05.tgz`).

## Packages
- `core/` (`@facet/core`) — `Painter` interface, `Style` + colour/anim math, geometry, `layoutDag`, and all 44 widgets (charts / controls / inputs / feedback / display / navigation / collections / state).
- `render-term/` (`@facet/render-term`) — `CellPainter`: rasterize vectors → box-drawing + braille cells; `Screen` + ANSI codec.
- `render-dom/` (`@facet/render-dom`) — `SvgPainter`: DOM-free SVG string builder.
- `gallery/` (`@facet/gallery`) — the component catalog (`npm run -w @facet/gallery build` → `dist/gallery.html`) + the in-terminal storybook (`npm run -w @facet/gallery storybook`).

## Gates (`npm run engine:gate`, first step in CI)
- `lint` (`engine/lint.mjs`) — bloat: files ≤300 lines, fns ≤60.
- `typecheck` — every package.
- `test` — unit + **parity-44** (each widget renders + agrees on labels in both backends) + **snapshot-88** (cell-grid + SVG per widget; rendering regressions diff here).

Imports stay `@facet/*` everywhere — consumed by `src/tui/*` (terminal control center) and `src/ui/app/*` (browser). The published `dist/` esbuild-bundles each package to `dist/node_modules/@facet/*` so plain node runs it.
