# cauldron-ts ("Ember") — project wiki

_Curated 2026-06-28 (the auto `spec` finds 0 modules — source lives under
`packages/*/src` in this monorepo, so this page is hand-written from
`audit`/`quality`/`status` + repo stats). Full report: `cauldron-ts/docs/ANALYSIS.md`._

## What it is

A reusable, data-driven TS sim engine ("Ember") ported from the Rust `cauldron`
`sim-core`, plus cauldron as the reference game. npm-workspaces monorepo, built largely
by the probevane $0 bridge factory.

| Package | Files / LOC | Role |
|---|---|---|
| `packages/engine` | 26 / 3781 | pure deterministic sim + appearance (vitest, own goldens) |
| `packages/render` | 15 / 2352 | raw-WebGL2 instanced renderer + procedural animation |
| `apps/web` | 4 / 881 | React shell + WebGL bench (`#bench`, `?part=`/`?static`/`?zoom`) + e2e |
| `games/cauldron` | 6 / 368 | content as DATA (essences / ingredients / biomes) |

## Health

- **`gate.sh`: GREEN** — 354 unit tests / 42 files (engine 176, render 144, cauldron 26,
  web 8) + Playwright e2e (perf3d, bench, blink, perf) green on real GPU (RX 9070 XT).
- `audit`: 46 specs, score 0/5 — almost all in `apps/web/e2e/perf3d.spec.ts`
  (`waitForTimeout` ×5 + 1 assertion-free). Follow-up: de-flake those.
- `quality`: grade 10/100 (advisory) — hotspot `render/src/webgl3d.ts` (846 LOC > 300;
  `renderFrame` 56 > 50; `setPartFilter` complexity 21). Follow-up: split it into
  rig/shaders/upload modules. Minor dup in `engine/src/visual-plus.ts`.
- `status` "8 failed" = root-adapter scope artifact (apps/web jsdom + e2e under one
  runner); the real per-workspace gate is green.

## Notable subsystems

- **Appearance** (`engine/src/visual-plus.ts` + `visual-parts*.ts`, `face.ts`, `skin.ts`,
  `palette2.ts`): genome → richAppearance2 ModelDescriptor (body plans, faces, skin,
  boost palette). Golden-locked (`visual-plus.test.ts`).
- **Renderer** (`render/src/webgl3d.ts`): raw WebGL2, instanced, faceted-clay, shadow maps,
  tilted-ortho camera, 2-bone gait IK (`solveLegs`/`solveArms`), eye-blink, part-isolation
  (`setPartFilter` + camera `targetY`) and static-pose QA mode.
- **Animation** (`render/src/animate.ts` + `animate-plus.ts` + `blink.ts`): pure
  deterministic motion (breathe/bob/state-bow/footTarget/gaitIK/idleSway/armSwing/blink).
- **ADO integration** (probevane side): this project's eye-blink feature was authored as an
  ADO work item, pulled + resolved by the loop on the $0 bridge, QA-documented with
  before/after artifacts.

## Tooling

- Refinement: the `refine-creature-part` skill drives the `?part=` isolate-and-fix loop.
- $0 builds: `probevane.config.json` pins `model: bridge`.
- Bench screenshots go to `cauldron-ts/.bench-shots/` (gitignored), not the cwd.
