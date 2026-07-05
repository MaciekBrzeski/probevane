# probevane wiki

A unified, transferable agentic harness that **adds unit + e2e tests to a project**. It drives an LLM through a *gated loop*: the model can only finish once the tests it wrote are real, green, and clean.

> Run this wiki locally: `npm run wiki` → http://localhost:4173

## What it is

probevane distills three prior efforts into one tool:

| Source | What we took |
|---|---|
| **qaforge** | test-generation craft — audit rules, prompt patterns, the learning library |
| **runestone** | the gated agent loop — composable *Runes* that gate every turn and the finish |
| **fourier-nca** | measured discipline — control/intervention vs baseline, append-only improvement-log, honest negatives |

## The one-paragraph mental model

You point probevane at a project. An **adapter** detects the stack (React first) and knows how to install, probe, run, and measure tests for it. The **loop** asks a **brain** (an LLM) to read the code, plan, and write tests via a small tool surface. **Runes** gate the loop: `plan_first` forces a plan before any test is written; `validation_gate` refuses to let the run finish while typecheck or the suite is red. The harness proves *itself* by running over **fixtures** in an **eval** suite and logging quality over time.

## Start here

- [Operations](Operations.md) — run it in a fresh / isolated / production environment (install, build, secrets, env, security)
- [Task paths](Paths.md) — write-tests · refactor · feature · repair · fix
- [Worktree mode](Worktree.md) — isolated, reviewed (self-)improvement runs
- [Commands](Commands.md) — full CLI reference (generated, gated)
- [Control Center](Control-Center.md) — the daemon's LCARS console: live pipeline light show, theater replay, TSX build
- [Drawing Engine](Drawing-Engine.md) — facet: one vector `Painter`, two backends (SVG + terminal cells); the 44-widget library both control centers share
- [Architecture](Architecture.md) — the pieces and how they connect
- [The Loop](The-Loop.md) — turn-by-turn control flow
- [Runes & Gates](Runes-and-Gates.md) — what blocks the model and why
- [Adapters](Adapters.md) — the modularity contract
- [Brains](Brains.md) — the LLM driver
- [Audit & Library](Audit-and-Library.md) — quality gate + few-shot flywheel
- [Eval & Fixtures](Eval-and-Fixtures.md) — how the harness tests itself
- [CLI](CLI.md) — commands
- [Decisions (ADR)](Decisions.md) — why we chose what we chose
- [Phase Log](Phase-Log.md) — what shipped, phase by phase
- [Glossary](Glossary.md)

## Projects

The **Projects** section (sidebar) holds a generated specification + dependency diagram for each codebase probevane has analyzed — see [Projects](Projects.md) to publish one (`probevane spec <dir> --narrate --wiki`).

## Status — core + improvement batch complete ✅

**Improvement batch:** token caching (~40% lower billed input) · anti-gaming + `hermetic_gate` + opt-in mutation gate · **mock maker** (synthesizes network/dep/prop/time mocks via MSW, chains module output→input contracts across the import graph) · **Vue** added as a 3rd stack with zero core-logic edits. Three stacks (React/Vue/Python) self-score in CI; react-shop multi-module networked app → 38 hermetic tests @ 100% cov, no real backend. See [Mock Maker](Mock-Maker.md) + [Phase Log](Phase-Log.md).

## Status — base build (P0–P6) ✅

- **React**: from zero → 31 unit @ 100% cov + 7 e2e @ 0 flake, audit-clean.
- **Python**: same loop/gates/brain → 22 pytest tests (only the adapter differs — modularity proven).
- **Self-test**: 3 fixtures scored in CI (no-regression gate, append-only improvement-log, diary + caveat harvest).
- **First real run** on a fresh *unseen* React app: 22 unit @ 100% cov + 5 e2e @ 0 flake, zero human edits — with `path_guard` fencing the toolchain and a Sonnet **takeover** rescuing the stalls.

See [Phase Log](Phase-Log.md) for the full per-phase record and the bugs each phase surfaced.
