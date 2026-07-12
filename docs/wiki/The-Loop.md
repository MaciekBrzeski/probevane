# The Loop

Ported from runestone's `engine.rs::run_loop`. Lives in `src/loop/engine/index.ts`.

## One turn

1. **onTurnStart** — every rune gets a tick (refresh few-shot, etc.).
2. **brain.complete** — the LLM returns text + zero-or-more tool calls + a stop reason.
3. **If there are tool calls:** for each, run `beforeToolCall` gates. First block short-circuits that call (its feedback is returned to the model as an error tool-result). Allowed calls execute via `tools.ts`, then `afterToolCall` observers run.
4. **If there are no tool calls** (model wants to stop): run `shouldStop` gates. First block → inject feedback as a user message, continue the loop. All allow → **accept** and break.

## Accept / continue / stop

| Situation | Outcome |
|---|---|
| Model emits tool calls | run them (gated), continue |
| Model stops, a `shouldStop` rune blocks | inject the reason, `barren++`, continue |
| Model stops, all gates allow | **accepted**, break |
| loop is **circling** (same gate-block or identical call ≥3×, after consult) | stop (`difficulty`) + **propose a way forward** |
| `barren >= forceStopAfter` | give up (`stuck`) — avoids burning tokens in a loop |
| `step >= maxSteps` | stop (`max_steps`) |
| `tokensOut >= budget` | stop (`budget`) |
| brain throws after retries | stop (`error`) |

`barren` counts turns with no productive edit or a blocked stop. It resets to 0 whenever a `write_file`/`edit_file`/`delete_file` succeeds. Escalation only counts barren turns **after the first edit** (initial read/plan is not a stall). When `barren ≥ consultAfter`, the **consult ladder** fires once — extra guidance + optional **takeover** by a stronger brain — before `forceStopAfter` gives up. See [Brains](Brains.md).

## Difficulty gate + weak-model handling

- **Difficulty gate** (`src/loop/difficulty.ts`): after the consult ladder has fired, if the loop is **circling** — the same gate-block reason, or an identical tool call, repeats ≥3× — stop early with `stopReason: 'difficulty'` and emit a **proposal** (deterministic summary of the blocker + suggested next steps; one LLM proposal turn if budget remains). Beats silently burning the step budget on a stuck run.
- **Never-edited stop**: a model that never writes a file (e.g. a weak local model emitting prose) keeps hitting the same stop-block; since consult/`forceStopAfter` gate on "has edited", it would otherwise run to `max_steps`. If `forceStopAfter` turns pass with zero edits and the block is repeating → difficulty stop, fast + free.
- **Selective exemplar on first block**: on the first stop-block after an edit, the most-similar accepted spec is injected alongside the gate feedback (failures-only retrieval — a fourier-nca lesson; blanket retrieval is noise).
- **Local / non-tool-calling models**: `--model local:<id>`/`bridge` turn on **text-extract** (a fenced code block in the model's prose becomes a `write_file`) + **minimal-system mode** (a focused prompt replacing the gate instruction-wall a small model chokes on; gates still verify). Output budget matters — too small truncates the test mid-fence; see [Brains](Brains.md).

## The tool surface (`tools.ts`)

Deliberately small — the model writes tests, it does **not** get a "run tests" tool it could game:

| Tool | Purpose |
|---|---|
| `read_file` | read project-relative source |
| `list_dir` | list a directory |
| `plan` | record the test plan (unlocks writes — see `plan_first`) |
| `write_file` | create/overwrite a test file |
| `edit_file` | unique-match string replace |

**Writes** are confined to the run's dir (no absolute paths, no `..` escapes — `path_guard`).
**Reads** (`read_file`/`list_dir`) may reach anywhere under the **workspace/repo root** (the
nearest ancestor with `pnpm-workspace.yaml` / a `package.json` `workspaces` / `.git`, else the
workdir) — so a focused run inside a monorepo package can read the sibling packages it imports,
instead of guessing their shapes. A per-run read budget nudges the model to edit rather than
crawl.

**Focused runs (`--only <path>`)** inject a **repo-map** (the target's importers + imports) and a
**dependency-API digest** (the export signatures of the workspace packages + relative modules the
focus file imports) into the task up front — so the model edits instead of crawling, and need not
read those modules at all (the "remove the need" complement to workspace-scoped reads).

## Why tests aren't a tool

Running the suite is the **gate's** job (`validation_gate.shouldStop` calls `adapter.run`). If the model could call "run tests" itself it could stop right after a green-looking partial run. By making the green check a finish-gate over the *whole* suite, "done" always means "the real suite is green right now". See [Runes & Gates](Runes-and-Gates.md).
