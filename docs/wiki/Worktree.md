# Worktree mode — isolated, reviewed (self-)improvement

Any [task path](Paths.md) (`feature` · `refactor` · `repair` · `fix` · `migrate` · `document`)
can run inside a throwaway **git worktree** instead of editing the live tree. The run
executes on its own branch; the live working tree is **never touched until an explicit
merge**. This makes a clean before/after possible and makes self-improvement (probevane
refactoring its own loop) safe.

## Flags

| Flag | Effect |
|---|---|
| `--worktree` | Run in an isolated worktree on a `probevane/<cmd>-<id>` branch. On accept, the change is committed on that branch and **kept for review** (the command prints `diff`/`merge` instructions); the live tree is untouched. On reject/error the worktree **and** branch are discarded. |
| `--worktree-merge` | On accept, [self-review](#review-gate) the diff and, if clean, **auto-merge** the branch into the original branch and clean up. A review `error` finding **blocks** the merge (branch kept for a human). |
| `--worktree-review` | Self-review the accepted diff and print the findings, **without** merging. |

## Lifecycle

1. Requires a git repo with ≥1 commit (else the run errors). The worktree branches off `HEAD`.
2. Creates the worktree under `$TMPDIR` and **symlinks every `node_modules`** from the source
   tree into it — root *and* nested (e.g. `fixtures/*/node_modules`) — so `tsc`/the test runner
   resolve everywhere, not just hoisted root deps.
3. Runs the gated loop with `workdir` = the worktree (the [adapter](Adapters.md) is path-agnostic,
   so the same stack config applies).
4. **Accept** → commits **only the run's edited files** (`outcome.editedFiles`) — never
   `git add -A` — then self-reviews the commit, then keeps the branch (or merges).
5. **Reject / error** → removes the worktree and deletes the branch. Nothing reaches the live tree.

## Review gate

On accept the committed diff (vs `HEAD~1`, so new files are included) is reviewed by the run's
takeover [brain](Brains.md) via the same `review/diff-review` reviewer the `ci --review-fix` path
uses. Findings are `error` / `warn` / `nit`. With `--worktree-merge`, **any `error` blocks the
auto-merge** — the gates prove the suite is green, but a green suite can't catch a dropped case or
a behavior change; the reviewer can. `error` is reserved for genuine correctness/behavior risk.

## $0 self-improvement (bridge + the probevane-brain agent)

The intended self-improvement flow is `--model bridge` (a host-serviced, $0 brain) run under
`--worktree`. A run is serviced by the **`probevane-brain`** agent (`.claude/agents/`): it reads
each bridge request, responds with tool calls, **adapts to gate feedback** (fixing the named
failing test / quality threshold / type error rather than re-finishing), and answers the
post-accept review request with honest JSON findings. A deterministic servicer can't react to gate
feedback and will stall — the agent's whole discipline is to adapt.

Workflow: **dogfeed a self-fix via `--worktree` → review the before/after diff → merge.**

## Gotchas

- **Branches off `HEAD`** (committed state) — uncommitted changes in the live tree are *not*
  carried in; commit work-in-progress first if it should be included.
- **Never `git add -A`.** Only `editedFiles` are committed. (An early hand-run used `-A`, which
  captured the worktree's `node_modules` symlink and, on merge, replaced the real `node_modules`
  with a self-referential link — the foot-gun is designed out.)
- A crash mid-run can leave a stray worktree — recover with `git worktree prune` / `git worktree remove`.
- Review under `--model bridge` is itself a bridge request — the servicer must answer it (the
  `probevane-brain` agent does).

## Examples

```bash
# isolate + keep the branch for manual review
probevane refactor . --worktree --quality --task "extract helpers in src/foo.ts"

# isolate, self-review, and auto-merge only if the review is clean
probevane fix . --worktree --worktree-merge --task "handle the null case in parse()"

# isolate + surface a review, no merge
probevane feature . --worktree --worktree-review --task "add a discount field to cartTotal"
```

See [Task paths](Paths.md), [Brains](Brains.md), and [Decisions (ADR)](Decisions.md).
