# Runes & Gates

A **Rune** is a gate plugged into fixed hooks of the loop (ported from runestone's `Rune` trait). Order matters — the first to block wins.

## Hooks (`src/loop/rune.ts`)

| Hook | When | Used for |
|---|---|---|
| `systemPromptAddition` | prompt assembly | tell the model the rule |
| `prepare` | once, pre-run | async RAG / few-shot (P2) |
| `onTurnStart` | each turn | refresh state |
| `beforeToolCall` | before a tool runs | **veto** a call |
| `afterToolCall` | after a tool runs | observe / track |
| `shouldStop` | model wants to finish | **gate the finish** |
| `onStop` | run ends | diary / harvest (P4) |

A decision is `allow` or `block{reason, inject}`. `inject` is the text fed back to the model so it can fix the problem.

## Shipped runes

### path_guard (`beforeToolCall`)
Denies writes/deletes to `node_modules`, build output (`dist`/`build`/`coverage`), and lockfiles. `tools.ts` already blocks `..`/absolute escapes, but dependencies live *inside* the project — without this a stalled model can (and did) corrupt the toolchain. First in the pipeline. See ADR-008.

### plan_first (`beforeToolCall`)
Blocks `write_file`/`edit_file` until the `plan` tool has been called once. Forces the model to state targets, behaviors, and the concrete assertions each test will make *before* writing. This is the seam where probe-grounding plugs in (P2/P3).

### validation_gate (`shouldStop`, scope-aware)
The run **cannot finish** while any of these hold:
- no test file was written (`editedFiles` empty);
- typecheck fails (`adapter.commands().typecheck`);
- the suite for the scope (unit or e2e) is not green — failures, zero passing, or all-skipped (the qaforge *all-skipped* anti-pattern, promoted to a hard gate).

On block it injects the failing command's tail so the model can repair.

### audit_gate (`shouldStop`)
No finish with any error-severity audit violation in the touched specs. See [Audit & Library](Audit-and-Library.md).

### acceptance_gate (`shouldStop`)
The deliverable must actually be covered: a minimum passing-test count, a minimum statement-coverage %, and any raw shell checks (exit 0). Ported from runestone `acceptance_gate.rs` — the recurring lesson is that acceptance must cover the *visible* deliverable, not just compile.

### no_regression (`prepare` + `beforeToolCall`)
Snapshots the spec files that existed at run start; blocks any `write`/`edit`/`delete` targeting one of them. Together with `validation_gate` (suite stays green) this guarantees existing tests are **untouched and still pass** — you add tests, you never weaken them.

### session_diary (`onStop`)
Writes a per-run record (outcome, steps, tool calls, gate blocks + reasons, edited files, hadPlan) to `<workdir>/.probevane/diary/` — overwatch of every run.

### caveat_harvest (`onStop`)
Appends the run's distinct gate-block reasons to a shared `caveats.md` (deduped); `context_inject` injects recent caveats into future runs, so the loop learns from its own friction. Empty on a clean run.

## The `write_tests` profile

An ordered pipeline (runestone's profile idea), in `src/loop/profiles.ts`. beforeToolCall order: `plan_first` → `no_regression`. shouldStop order: `validation` (fast fail) → `audit` (static) → `acceptance` (count/coverage).

```
write_tests = [ context_inject(kind), path_guard, plan_first, no_regression,
                validation_gate(scope), audit_gate, acceptance_gate,
                session_diary, caveat_harvest ]
```

When the loop stalls, the **consult ladder** escalates once (extra guidance + optional **takeover** by a stronger brain) before `forceStopAfter` gives up — see [The Loop](The-Loop.md) and [Brains](Brains.md).

## Why gates beat instructions

An instruction ("please make the tests pass") is advisory — the model can stop early. A gate is enforced by code that runs the real suite. The loop *builds exactly what the gates enforce*, so the gate set is the spec. (Hard-won runestone lesson: acceptance must cover the visible deliverable.)
