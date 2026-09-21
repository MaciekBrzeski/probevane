# Signals

Fine-grained reactive layer for the control center: `src/ui/signals.ts`. UI = f(state) **without a vdom** — `h()` builds real DOM once, function-valued props/children become live bindings, and a state change updates exactly the text node or attribute that depends on it. Solid's model, minus the compiler, in ~250 lines with zero dependencies.

It complements — does not replace — `runtime.ts`. `mount()` full-replace stays right for panels that repaint wholesale from a snapshot. Signals are for panels with **frequent partial updates over long-lived lists** (runs history, jobs, factory queue), where full rebuild costs layout and loses DOM state (scroll, focus).

## Why it exists

Benchmarked the control center's rebuild-everything model against React 19 (js-framework-benchmark-style row ops + the 44-widget facet gallery, Chromium, script+forced-layout timing). Full rebuild lost partial updates 2.5×. Closing that gap imperatively (keyed reconciler + hand-written `patch()`) matched React's speed but reintroduced React's actual selling point as OUR liability: every hand-managed DOM detail is a chance to silently forget one. The experiment hit that bug class twice — a stale-DOM aliasing no-op and a stale highlight surviving node reuse — both caught only by a cross-implementation DOM-fingerprint oracle, not by any error.

Signals close the gap **declaratively**: there is no "sync the DOM" call to forget. Mutation flows only through `Signal.set/update`; bindings fire themselves.

## Numbers (median ms; 5-way oracle-verified: every implementation must produce byte-identical DOM)

1k rows:

| op | imperative best | signals | React 19 |
|---|---|---|---|
| create 1k | 19.9 | 18.8 | 18.3 |
| update every 10th | 4.5 | 4.5 | 5.5 |
| swap 2 rows | 1.1 | 1.3 | 18.9 |
| select row | 0.00 | 0.00 | 0.80 |
| append 1k | 17.7 | 18.4 | 20.6 |
| clear | 2.4 | 2.5 | 4.8 |
| heap 1k rows | 211 KB | 795 KB | 1061 KB |
| bundle (gz) | 2.3 KB | 2.8 KB | 61 KB |

10k rows (gap widens with scale):

| op | signals | React 19 |
|---|---|---|
| create 10k | 198 | 260 |
| update | 67 | 88 |
| swap | 16 | 49 |
| select | **0.1** | 9.0 |
| append 10k | 216 | 334 |
| clear | 41 | 81 |

The ~600 KB heap over the imperative variant is the price of declarativity (one Signal + binding Effects per row); still 25% under React's fibers.

**Signal storm** (sustained-load stress, uncapped rAF, ~1100 mutations/frame across five concurrent streams — 900-signal wave grid, keyed list rotated/swapped/churned every frame, selector sweep, 40 `when()` toggles, 8-deep computed chain; DOM invariants verified every 60 frames, 15 s):

| metric | signals | React 19 (memo'd) |
|---|---|---|
| fps | **327** | 296 |
| mean frame work | **0.27 ms** | 0.56 ms |
| p95 | **0.4 ms** | 0.8 ms |
| heap growth | **336 KB** | 749 KB |
| invariant failures | 0 | 0 |

Three engine changes came out of the storm: a **stable-deps fast path** (a re-run reading the same signals walks its subscriptions instead of unsubscribe/resubscribe churn; divergence from a dynamic branch drops the stale tail), **last-value write guards** on class/text bindings (identical-value writes still dirty style — React's diff skipped these, we didn't), and a **two-pointer keyed diff** in `eachInto` (udomdiff-style: rotate-by-one is ONE `insertBefore`, not n — the naive cursor's worst case was React's best case).

## API

```ts
import { signal, computed, effect, h, eachInto, when, flushSync, runInScope } from './signals';

const count = signal(0);            // Signal<T>: .get() .set(v) .update(f)
const label = computed(() => `${count.get()} runs`);  // memoized: downstream re-runs only when RESULT changes
effect(() => { console.log(label()); return () => cleanup(); }); // auto-tracks; cleanup before re-run + on dispose

// reactive h(): function-valued prop/child = live binding
const el = h('div', { class: () => (count.get() > 9 ? 'hot' : '') }, () => label());

// keyed list: order/membership only; row content updates via the row's own signals
eachInto(tbody, () => rows.get(), (r) => r.id, (r) =>
  h('tr', null, h('td', null, () => r.name.get())) as HTMLElement);

// conditional subtree, truthiness-memoized, bindings disposed on teardown
parent.appendChild(when(() => rows.get().length === 0, () => h('div', { class: 'empty' }, 'no rows')));

flushSync();  // commit now (event handlers reading layout, tests); otherwise batches per microtask
```

Rules that keep it fast and honest:

- **Item object identity is the dirty flag.** `eachInto` reuses a row's node when the item is identity-equal; a NEW object under a known key re-renders that row alone (old bindings disposed) — the safe default for snapshot data such as poll payloads. Signal-driven rows keep item identity across content changes and skip rebuilds entirely. For polled lists, stabilize identity first (reuse the previous object while its JSON is unchanged — see `stabilize()` in `app/main.tsx`) so an unchanged poll is zero DOM operations. Never mutate the array you passed and pass it again — pass a fresh array.
- **`eachInto` owns the parent's children exclusively.** Empty-states/spinners go OUTSIDE via `when()`.
- **Selector pattern for shared-among-rows state** (selection, hover): ONE effect toggling the affected nodes, not a per-row binding watching one signal — that's the difference between 2 class toggles and 1000 Effect objects (and the 0.1 ms vs 9 ms `select` row above).
- **Memory shape:** prototype-method classes, array subscriber lists, lazy cleanup allocation. Measured journey 1286 → 1014 → 795 KB; Sets and closure factories were the hogs, in that order.

## Limits (known, deliberate)

- No context, no error boundaries, no time-slicing/Suspense. Batching + `flushSync` is the whole scheduler.
- No TSX integration yet — `build-ui.mjs` jsxFactory still points at `runtime.ts` `h`; signals `h()` is call-style until a component opts in file-wide. Caution: under runtime `h`, a function-valued JSX child is stringified, not bound — keep reactive text in `effect`s or signals-`h` calls.
- DOM half (`h` bindings, `eachInto`, `when`) is browser-code, excluded from unit coverage like the rest of `src/ui/` — pinned instead by `tests/signals.test.ts` (state machinery, 10 tests), the bench oracle, and the e2e-dash suite through the adopted panel.

## Adoption status

The **Runs tab** is signals-driven (`app/main.tsx`, "Runs" section): run history + active-jobs box render through `eachInto`, empty-states through `when()`, the meta line through an `effect`, filtering through a `computed` (client-side, no refetch). The tab rides the 4s heartbeat — identity-stabilized snapshots mean an unchanged poll performs zero DOM operations, and a changed run re-renders its row alone. Covered by e2e-dash (row click → drawer transcript). Remaining panels still use `mount()` full-replace; migrate when a panel grows frequent partial updates.

Ambient layer (the perf headroom made visible). Discipline first: ALL JS animation runs on `app/motion.ts` — one shared rAF loop, paused on hidden tabs, dead under `prefers-reduced-motion`; every CSS rule that moves sits inside `@media (prefers-reduced-motion: no-preference)`. One OS preference stills the entire surface, and e2e (which emulates it via `reducedMotion: 'reduce'` in playwright.config) stays deterministic.

- **WaveStrip** (`components/chrome/WaveStrip.tsx`) — water line under the header; three parallax SVG wave layers, 3 `d`-attribute writes per frame, 30fps cap. `waveEnergy` (0 calm → 1 stormy) rises with active runs; `waveWeather` rains for 12 s when a NEW run arrives rejected (recycled 16-streak pool, attribute writes only) — failure you notice from across the room.
- **Live elapsed timers** on active runs — one 1 Hz `tickSig`, per-row `effect` created inside the `eachInto` render scope (dies with its row).
- **Run-row + active-job entrances** — `.anim-enter` slide, played once per genuinely NEW row: identity-stable snapshots mean a poll refresh animates only new arrivals (class removed on `animationend` so reorders never replay it).
- **Sliding tab underline** (`.tabind`) — measured + translated on tab switch and resize.
- **Project-card entrance stagger** (`--i` delay), **cost-bar grow** (scaleY, staggered, replay-guarded by the existing `changed()` poll dedupe), **running-tag shimmer**, **alert entrance**.

Numbers from a 2026-07-25 run (Chromium, CachyOS). The harness was a session-scratchpad experiment (4 vane variants + React 19, esbuild bundles, Playwright driver, DOM-fingerprint oracle); it is portable — `npm i react react-dom esbuild`, alias `@runtime`/`@facet/*` to this repo, run `build.mjs` then `run.mjs` — but not vendored here. Re-derive from this page's spec if numbers need refreshing.
