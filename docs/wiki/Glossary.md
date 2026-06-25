# Glossary

- **Adapter** — a `StackAdapter` implementation; everything language/framework-specific (detect, install, probe, run, coverage, audit rules). See [Adapters](Adapters.md).
- **Brain** — the LLM driver behind the `Brain` interface. See [Brains](Brains.md).
- **Rune** — a gate plugged into a loop hook; can veto a tool call (`beforeToolCall`) or the finish (`shouldStop`). See [Runes & Gates](Runes-and-Gates.md).
- **Gate** — a rune decision point. `validation_gate` and (later) `acceptance_gate`/`audit_gate` gate the *finish*.
- **Profile** — an ordered list of runes for a task type, e.g. `write_tests`.
- **RunCtx** — shared mutable loop state (plan, editedFiles, step, barren, …).
- **barren turn** — a turn with no productive edit or a blocked stop; `forceStopAfter` consecutive barren turns ends the run as `stuck`.
- **probe-before-spec** — gather real ground truth (exports/DOM/routes) before generating, so the model never guesses. A failed probe is a hard block.
- **shadow-oracle** — a hand-written known-good spec used to check a generated spec covers the right assertions (fourier idea).
- **improvement-log** — append-only CSV of per-run quality metrics; never rewritten.
- **honest negative** — a failing eval case kept and flagged rather than deleted.
- **takeover** — escalating a stuck run to a stronger model for a bounded window, still gated (P6).
- **learning library** — cross-project store of good/bad test examples at `~/.local/share/probevane/`, used for few-shot (P2).
