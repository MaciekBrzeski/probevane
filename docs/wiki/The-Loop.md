# The Loop

Ported from runestone's `engine.rs::run_loop`. Lives in `src/loop/engine.ts`.

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
| `barren >= forceStopAfter` | give up (`stuck`) — avoids burning tokens in a loop |
| `step >= maxSteps` | stop (`max_steps`) |
| brain throws after retries | stop (`error`) |

`barren` counts turns with no productive edit or a blocked stop. It resets to 0 whenever a `write_file`/`edit_file`/`delete_file` succeeds. Escalation only counts barren turns **after the first edit** (initial read/plan is not a stall). When `barren ≥ consultAfter`, the **consult ladder** fires once — extra guidance + optional **takeover** by a stronger brain — before `forceStopAfter` gives up. See [Brains](Brains.md).

## The tool surface (`tools.ts`)

Deliberately small — the model writes tests, it does **not** get a "run tests" tool it could game:

| Tool | Purpose |
|---|---|
| `read_file` | read project-relative source |
| `list_dir` | list a directory |
| `plan` | record the test plan (unlocks writes — see `plan_first`) |
| `write_file` | create/overwrite a test file |
| `edit_file` | unique-match string replace |

All paths are confined to the project dir (no absolute paths, no `..` escapes).

## Why tests aren't a tool

Running the suite is the **gate's** job (`validation_gate.shouldStop` calls `adapter.run`). If the model could call "run tests" itself it could stop right after a green-looking partial run. By making the green check a finish-gate over the *whole* suite, "done" always means "the real suite is green right now". See [Runes & Gates](Runes-and-Gates.md).
