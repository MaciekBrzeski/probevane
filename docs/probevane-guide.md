# probevane — Comprehensive Guide

> Meta note: this guide was itself produced by probevane's own narrative documentation loop (`probevane docs`, implemented in `src/cli/docs.ts` and `src/loop/run-docs.ts`). The tool documents itself, and the same gates that protect every probevane run — structure, reference-integrity, and length — gated this very file. If you are reading it, those gates passed.

## Overview

probevane is a **unified agentic harness that adds unit and end-to-end (e2e) tests to an existing project**. You point it at a codebase, and a gated LLM loop probes the project for ground truth, writes test specs, runs them, statically audits their quality, and only accepts the work when every gate is green. It is language- and framework-agnostic by design: React, Vue, Svelte, Angular, plain Node (Vitest), Python (pytest), Go, and Rust are all supported through a single pluggable contract.

The project exists to make automated test generation **trustworthy** rather than a one-shot prompt. It distills three earlier assets (the patterns were ported; the originals are not modified):

- **qaforge** — test-generation craft: audit rules, prompt patterns, and a cross-project learning library of good/bad examples.
- **runestone** — the gated agentic loop, built from composable "Runes". A run is accepted only when all gates pass; otherwise feedback is injected and the loop continues.
- **fourier-nca** — measured evaluation: a control (the committed fixture) and an intervention (a regenerated run) judged against a baseline, with an append-only improvement log and honest negatives.

The authoritative project summary lives in `CLAUDE.md`; the full phase-by-phase build record is in `docs/wiki/Phase-Log.md`. probevane has been proven on fresh, unseen apps (e.g. a React app taken from 0 to 22 unit tests at 100% coverage plus 5 zero-flake e2e tests, and a Python project to 22 pytest tests).

## Architecture

The central architectural idea is a clean seam between *what is generic* (the loop, brains, audit core, library, eval) and *what is stack-specific* (everything behind one interface). The triad that drives every run is **Adapter + Runes + Brain**, orchestrated by the loop engine.

### The StackAdapter contract

`src/adapters/adapter.ts` defines `StackAdapter`, the modularity load-bearer. Each adapter knows how to `detect` a project (a 0..1 confidence the registry maximizes), `install` test deps and config idempotently, `discover` targets worth testing, `probe` a target for **ground truth before generation**, generate unit (and optionally e2e) specs, `run` the suites into pass/fail/skip counts, read `coverage`, expose language-specific `auditRules()`, and declare the shell `commands()` the gates execute. A failed probe is a hard block — the model is never allowed to guess. The registry that selects the winning adapter is `src/adapters/registry.ts`; when no stack applies (as in the documentation loop) a `src/adapters/null-adapter.ts` is used instead.

### The gated loop

`src/loop/engine.ts` runs the agent. It assembles the system prompt from a base plus each Rune's prompt additions and `prepare()` output (RAG/context injection), then loops: it asks the Brain to complete given the system prompt, the running transcript, and the tool specs from `src/loop/tools.ts`; for each tool call it consults the Runes' `beforeToolCall` hooks (the first block wins) before executing; when the model tries to stop, it consults the Runes' `shouldStop` hooks (and the adapter) — a block injects feedback and continues, an allow ACCEPTS. The transcript is pruned after a number of turns to stay bounded (files persist on disk, so the model can re-read), and Anthropic prompt caching breakpoints keep token cost down.

### The brain layer

`src/brain/brain.ts` defines the `Brain` interface; `src/brain/select.ts` resolves a model string to a concrete brain. The default is the Anthropic SDK driver (`src/brain/anthropic-sdk.ts`); alternatives include the Claude Code CLI driver (`src/brain/claude-code.ts`) and, notably, the **$0 bridge** (`src/brain/bridge.ts`), which writes request files to disk and blocks on response files so an external "bridge brain" can drive the loop at zero API cost. This guide's run used exactly that bridge.

### Audit, library, eval

Static quality is enforced by the language-agnostic scanner `src/audit/core.ts` plus per-language rule sets (e.g. `src/audit/rules-js.ts`). The cross-project learning library (`src/library/store.ts` for storage, `src/library/retrieve.ts` for few-shot selection) feeds worked examples back into generation. The harness's own measured test suite lives in `eval/` (cases in `eval/cases.jsonl`, scoring in `eval/scorer.ts`, results appended to `eval/improvement-log.csv`).

The architecture diagram and prose overview are also maintained in the wiki (`docs/wiki/Home.md`).

## Key concepts

**Adapters.** Adding a new stack means adding one folder under `src/adapters/` plus audit rules — the loop, library, and eval are untouched. First-class support targets React (Vitest + Playwright); additional adapters cover Vue, Svelte, Angular, Node (Vitest), Python (pytest), Go, and Rust.

**Runes and gates.** A Rune is a small composable unit that can contribute to the system prompt, intercept tool calls (`beforeToolCall`), inject RAG context (`prepare`), and veto stopping (`shouldStop`). Gate-flavored Runes include `plan_first` (`src/loop/runes/plan_first.ts`, no writes before a recorded plan), `path_guard` (`src/loop/runes/path_guard.ts`, write-scope allowlist), `acceptance_gate` (`src/loop/runes/acceptance_gate.ts`, test-count/coverage floors), and `hermetic_gate` (`src/loop/runes/hermetic_gate.ts`, no real network). Opt-in gates add flake, assertion-quality, mutation, a11y, visual, quality, and MFE checks. The documentation loop uses its own gate set in `src/loop/runes/docs.ts`: a structure gate (all H2 sections present and non-trivial), a reference-integrity gate (every cited repo path must exist on disk), and a length/acceptance gate.

**Profiles and subroutines.** `src/loop/profiles.ts` composes ordered Rune pipelines per task type — `write_tests`, `refactor`, `feature`, `repair`, `fix`, `migrate`, `document`, and `bare` — built from reusable subroutines (preamble, green-gates, safety-net, opt-in, harvest). This is the runestone-derived idea that the loop builds exactly what the gates enforce.

**Brains and the $0 bridge.** A run can be driven by the Anthropic SDK, the Claude Code CLI, or the file-based bridge brain for zero-cost dogfooding. Model routing (`auto`/`bridge`/haiku/sonnet/opus, plus `local:`/`openai:` pass-through) is handled centrally in `src/brain/select.ts`.

**Probe-grounding.** Before any generation, the adapter's `probe()` collects ground truth (exports, props, routes, signatures). Generation never proceeds on guesses; a failed probe blocks via `plan_first`.

**Consult ladder and takeover.** On stalls, the loop escalates: it consults a stronger model and, if needed, a stronger model takes over the edit directly — the mechanism that lets a cheap primary model finish hard tasks.

**Learning library and distill.** Accepted specs can be promoted into the library as `good` examples (with an audit-derived score) and retrieved as few-shot context on later runs. `src/distill/collect.ts` and `src/distill/dataset.ts` turn captured run traces into datasets for further improvement.

**Mock-maker.** `src/mock/index.ts` synthesizes hermetic mocks (e.g. from OpenAPI/types) and chains module output→input contracts so networked apps can be tested without a real backend.

**Measured eval.** The eval harness scores fixtures against committed baselines under `eval/`, appends an honest, never-deleted row to `eval/improvement-log.csv`, and acts as the harness's own no-regression gate.

## Project layout

Key directories and files (all paths relative to the repo root):

- `bin/probevane` — the CLI entry point; a bash dispatcher that runs the matching command module under `src/cli/` via tsx (or the compiled `dist/` directory when published).
- `src/adapters/` — the `StackAdapter` contract and one folder per stack (react-vitest-playwright, vue-vitest-playwright, svelte-vitest, angular, node-vitest, python-pytest, go-test, rust-cargo), plus `src/adapters/registry.ts`.
- `src/loop/` — the gated loop: `src/loop/engine.ts`, the Rune contract `src/loop/rune.ts`, the tool implementations `src/loop/tools.ts`, profiles `src/loop/profiles.ts`, and the Rune library under `src/loop/runes/`.
- `src/brain/` — LLM drivers and selection: `src/brain/brain.ts`, `src/brain/anthropic-sdk.ts`, `src/brain/claude-code.ts`, `src/brain/bridge.ts`, `src/brain/select.ts`.
- `src/audit/` — the language-agnostic audit engine `src/audit/core.ts` plus per-language rules such as `src/audit/rules-js.ts`.
- `src/library/` — the cross-project learning library (`src/library/store.ts`, `src/library/retrieve.ts`).
- `src/distill/` — trace collection and dataset building (`src/distill/collect.ts`, `src/distill/dataset.ts`).
- `src/mock/` — the mock-maker (`src/mock/index.ts`).
- `src/docs/` — the project digest builder `src/docs/digest.ts` used by the documentation loop.
- `src/cli/` — one module per command, including `src/cli/generate.ts`, `src/cli/eval.ts`, and `src/cli/docs.ts`.
- `eval/` — the harness's own measured suite: `eval/cases.jsonl`, `eval/scorer.ts`, `eval/improvement-log.csv`, plus `eval/baseline/`.
- `fixtures/` — zero-/low-test apps the harness runs against (e.g. react-forms, py-calc, go-calc, rust-calc, vue-counter, angular-counter, svelte-counter, react-shop, react-todo).
- `docs/wiki/` — the living wiki, including `docs/wiki/Loop-Pipeline.md`, `docs/wiki/Phase-Log.md`, and `docs/wiki/Home.md` (regenerate with `scripts/wiki.mjs`).
- `package.json` and `CLAUDE.md` — manifest and authoritative project summary at the repo root.

## Getting started

probevane is ESM TypeScript run directly with tsx (no build step required for development); it targets Node 22+ and depends on `@anthropic-ai/sdk` and `ts-morph` (see `package.json`).

1. **Install dependencies** in the repo root with your package manager (e.g. `npm install`). For e2e generation you also need Playwright browsers installed.
2. **Provide a model** — set `ANTHROPIC_API_KEY` for the default SDK brain, or select another brain (Claude Code, the `bridge`, or a `local:`/`openai:` model) via the `--model` flag / config.
3. **Run a command** with the CLI: `./bin/probevane <command> <dir>`.

Common commands (full list in the dispatcher `bin/probevane`):

- `probevane init <dir>` — detect the stack, scaffold config, install test deps.
- `probevane plan <dir>` — probe the target and emit a grounded plan (no edits).
- `probevane generate <dir> [--kind unit|e2e|all]` — run the gated loop to write tests (see `src/cli/generate.ts`).
- `probevane run <dir> [--scope unit|e2e|all]` — execute suites via the detected adapter.
- `probevane audit <dir>` — static quality gate over specs.
- `probevane coverage <dir>` / `probevane status <dir>` — coverage and dashboard.
- `probevane learn` — curate the cross-project learning library.
- `probevane eval` — score fixtures against baselines and append `eval/improvement-log.csv` (see `src/cli/eval.ts`).
- `probevane docs <dir>` — write a narrative guide like this one (see `src/cli/docs.ts`).

There are many more task paths in `src/cli/` (feature, refactor, repair, fix, review, document, spec, graph, migrate, factory, daemon, and others). Configuration is resolved with the precedence **CLI flag > `probevane.config.{ts,json}` > default**, implemented in `src/config.ts`.

Useful npm scripts (from `package.json`): `npm test` (Vitest), `npm run coverage`, `npm run typecheck`, `npm run eval`, `npm run wiki` (regenerate the wiki via `scripts/wiki.mjs`), and `npm run test:e2e` (Playwright).

## Glossary

- **StackAdapter** — the per-language/framework contract in `src/adapters/adapter.ts`; isolates all stack-specific behavior so the rest of the system stays generic.
- **Registry** — `src/adapters/registry.ts`; picks the adapter with the highest `detect()` confidence.
- **Probe** — adapter step that gathers ground truth about a target before generation; failure hard-blocks the loop.
- **Rune** — a composable loop unit (defined in `src/loop/rune.ts`) that can add prompt text, intercept tool calls, inject context, and veto stopping.
- **Gate** — a Rune whose `shouldStop` blocks acceptance until a condition holds (e.g. plan recorded, tests pass, audit clean, references valid).
- **Profile** — an ordered Rune pipeline for a task type, composed from subroutines in `src/loop/profiles.ts`.
- **Engine** — the orchestration loop in `src/loop/engine.ts` that ties Adapter + Runes + Brain together.
- **Brain** — an LLM driver implementing the interface in `src/brain/brain.ts` (Anthropic SDK, Claude Code, or bridge).
- **Bridge brain** — the $0 file-based driver (`src/brain/bridge.ts`): writes request files and blocks on response files so an external process can drive the loop.
- **Consult ladder / takeover** — escalation to a stronger model (advice, then a direct edit) when a run stalls.
- **Audit** — static quality scan (`src/audit/core.ts` + rule sets like `src/audit/rules-js.ts`) used both as a CLI gate and the `audit_gate` Rune.
- **Learning library** — cross-project store of good/bad examples (`src/library/store.ts`, `src/library/retrieve.ts`) feeding few-shot context.
- **Distill** — turning captured run traces into datasets (`src/distill/collect.ts`, `src/distill/dataset.ts`).
- **Mock-maker** — hermetic mock synthesis and contract chaining (`src/mock/index.ts`).
- **Fixture** — a zero-/low-test sample app under `fixtures/` used as an eval input.
- **Baseline** — committed expected scores under `eval/baseline/` that fixtures are judged against.
- **Improvement log** — the append-only, never-deleted record of eval outcomes (`eval/improvement-log.csv`).
- **Documentation loop** — the stack-agnostic narrative-docs run (`src/cli/docs.ts`, `src/loop/run-docs.ts`, gates in `src/loop/runes/docs.ts`) that produced this guide.
