# Test Effectiveness — mutation, ratchet, and cross-project research

Well-formed ≠ correct. Green tests + coverage floors prove a suite *runs* and *touches*
lines; they don't prove it *catches bugs*. probevane's correctness floor is the **mutation
gate** — flip one operator, rerun the suite, see if a test dies. A surviving mutant is a
line the tests don't actually pin.

This page records what a full self-mutation sweep found, the standing gate built from it,
and the cross-project research (from sibling repos + the overseer knowledge base) that
shaped the design.

## The sweep

A whole-repo budgeted sweep (`mutation . --budget 250`, 2505 eligible sites, 10% sampled)
put probevane's own global mutation score at **~0.60**. Read that as: the suite is
well-formed, but ~40% of sampled operator mutants aren't behaviorally pinned. Triage of the
survivors:

- **~72% noise** — display/side-effect operators: cost/loc accumulators, string concat,
  env toggles, CLI-flag routing, interactive `process.exit`, mutation-of-the-mutation-engine.
  Flipping them changes no decision; killing them is coverage-theater.
- **~28% logic** — operators inside real control flow. A handful gate genuine decisions
  (killed this pass in `src/ui/runtime.ts`, `validation_gate`, `red_first`); the rest are
  env/CLI/interactive or integration-heavy single mutants (low ROI per mutant).

Lesson: chase survivors that change a *decision*, not every survivor. Report the rest as
mapped noise — a silent 40% is more honest than a forced 100%.

## The standing gate — a per-dir ratchet

A single global `--min-score` can't localize a regression and can't be driven upward. The
quality gate already solved this shape (`src/quality/baseline.ts`: a committed baseline that
suppresses known violations so only NEW ones gate). The mutation ratchet mirrors it:

- `src/loop/mutation-baseline.ts` — `byDir()` rolls the run's per-file tallies up to
  top-level dirs (`topDir`, `src/arch/metrics.ts`); `writeMutationBaseline()` records each
  dir's score **rounded down to a 0.1 band** into `.probevane/mutation-baseline.json`
  (committed); `checkRatchet()` returns the dirs whose current score fell below their band.
- CLI: `mutation . --ratchet` (exit 1 on any dir regression), `--write-baseline` (re-seed
  the floors), `--log <csv>` (append the score to a time-series).
- CI runs `mutation . --budget 250 --ratchet --min-score 0.5`. The **budget must match the
  budget the baseline was seeded with** — the site sampler is deterministic even-stride, so
  a different budget picks different sites and the per-dir scores no longer align.

Why 0.1 bands: the sample drifts as code is added/removed (the stride shifts across the
growing site set), so per-dir scores wobble a few percent between commits. A band absorbs
that while still catching a real regression (a dir dropping a whole band). Gradual within-band
drift is tracked by the time-series (`eval/improvement-log.csv`, `mutation` column), not the
gate.

## Cross-project research

Findings from sibling repos in `~/Dokumenty` (via the overseer MCP and probevane's own
`src/library`) that back this direction:

- **cauldron-ts** — a TS game engine **built $0 by probevane's bridge factory** (14 modules /
  104 tests, Phase-2 entirely at $0 actual). Its `spec/oracles.md` defines a richer correctness
  contract than operator mutation — an **acceptance-oracle taxonomy**, "each becomes a
  probevane per-module gate":
  - **byte-stable** — fixed seed → identical stream (locked golden).
  - **golden** — fixed input → locked structured snapshot.
  - **invariant** — holds every tick/state (e.g. conservation / mass balance).
  - **property** — holds over many random seeds (bounds, monotonicity, distribution shape).

  This is the source for the *typed acceptance oracles* research direction (an ADR + phased
  build): mutation asks "do the tests pin behavior?"; oracles express "what behavior means."
  Calibration note: probevane's own `quality --strict` graded cauldron-ts **10/100** while its
  `gate.sh` is green — probevane's strict thresholds are tuned for a *test harness*; keep them
  advisory on app repos.
- **100-monkeys** — already runs a **gated candidate≥baseline ratchet** in production
  (`scripts/refresh-lora.sh` promotes a LoRA only if `validRate ≥ baseline && schema ≥
  baseline`): direct precedent for the mutation ratchet. Also a **post-loop false-green gate**
  (`verify-loop-fills.sh` greps for surviving `todo!()` stubs after a loop reports "all done")
  — the same "don't trust the green, re-verify" discipline that motivates persisting mutation
  survivors instead of recomputing them each run.
- **tessera** — self-improving LLM harness; importance-3 lesson: *"Task distribution is the
  damage — style, authorship and geometry all marginal."* What you measure and distribute
  dominates the outcome — bears on any future distill/eval work.
- **onshape / cad-agent** — conventional 80% coverage CI floors (Codecov threshold); cad-agent
  notes the natural multi-core lever is the **fleet** (probevane running many repos/units in
  parallel), not inside one unit — relevant if the ratchet sweep is ever parallelized.

## The open gap

Mutation survivors and assertion-strength signals (`src/audit/assertion-score.ts`,
`assertion_gate`) are computed but not yet persisted as durable, cross-project lessons —
caveats are flat strings, the library stores only good/bad specs, distill stores only accepted
traces. The cheapest fix (survivor → `caveats.md` → `context_inject` → future prompts) closes
the loop so "add a value-pinning assertion here" surfaces the next time the loop touches that
code. See the loop pipeline for the harvest runes.
