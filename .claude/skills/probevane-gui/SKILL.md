---
name: probevane-gui
description: Operate probevane through its control-center GUI (the Assistant tab) as the PRIMARY way of working — browser-driven, end-to-end. Use to dogfood the whole project through the dashboard, drive a run from the Assistant tab (interpret → plan → toggles → run → watch pipeline/transcript/notes → proposals → history), or when the user says "use the probevane GUI", "dogfood via the dashboard", "run it in the control center", "drive the Assistant tab". CLI is the fallback, not the default.
---

# probevane-gui — operate probevane through the control center

Drive probevane the way a user would: the **control center** in a browser, the
**Assistant tab** as the cockpit. This is the e2e dogfood path — it exercises the
daemon, `/assistant/*` + `/run` + `/stream` + `/transcript` endpoints, the live
pipeline, the transcript, opt-in gate toggles, rune notes, proposals, and history
in one flow. Reach for the CLI (`./bin/probevane`, or the generated `probevane`
skill) only when the GUI can't express a mode (see Fallback).

Browser control is the **playwright MCP** tools (`browser_navigate`,
`browser_evaluate`, `browser_take_screenshot`). Prefer one `browser_evaluate` that
does a whole step (query + click + fill + read a result) over many small calls.

## 0. Bring up the daemon (once)

The daemon serves the built `dist/` — so **after any code change, rebuild dist and
restart**, or the UI/back-end you're testing is stale:

Bootstrap — probe first, only (re)start when needed:
```sh
cd <probevane>            # your probevane checkout
# already up? then just use it (unless you changed code — then rebuild + restart):
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7766/ 2>/dev/null   # 200 = ready
# (re)start after a code change — the daemon serves dist/, not src/:
npm run build            # esbuild → dist/  (skip if only exercising, not changing code)
PID=$(ss -ltnp 2>/dev/null | grep ':7766' | grep -oE 'pid=[0-9]+' | cut -d= -f2)
[ -n "$PID" ] && kill "$PID"; sleep 1
nohup node dist/cli/daemon.js --port 7766 >~/.local/share/probevane/daemon-7766.log 2>&1 & disown
sleep 4; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7766/   # expect 200
```

For live TSX/CSS iteration (no rebuild per change) run `PROBEVANE_UI_DEV=1
./bin/probevane daemon --port 7766` instead — it recompiles the UI per request.
The daemon log (`~/.local/share/probevane/daemon-7766.log`) carries run stdout
(engine steps, `[euphony]` etc.) that the tab does NOT show — tail it to debug.

## 1. Open the Assistant tab

```
browser_navigate http://localhost:7766/
```
then (in `browser_evaluate`) click the tab and confirm it mounted:
```js
document.querySelector('nav.tabs button[data-go="chat"]').click();
// wait for #chat-dir to exist before interacting (app JS mounts async)
```
The tab has three regions: **conversation & transcript** (`#chat-convo`, left),
**plan & proposals** (`#chat-signals`, right — deterministic $0), **live pipeline**
(`#chat-tools`, bottom — the running run).

## 2. Drive one run (the core loop)

1. **Project path** — set `#chat-dir`. The datalist `#chat-dirs` holds real
   historical projects (`/assistant/dirs` resolves ledger labels to existing dirs).
2. **Request** — type an NL task into `#chat-prompt`, click `#chat-send`. This is
   the $0 deterministic interpret → a **plan card** (`.chat-signal`) appears in
   signals with op / kind / confidence / assumptions / context.
3. **Model + gates + run mode** — on the plan card's run row:
   - model: `select.chat-model` (auto / haiku / sonnet / opus / ollama:* — pick a
     capable one; weak models give up, see Gotchas).
   - opt-in gate toggles: `.chat-gate input` checkboxes — **euphony**, **quality**,
     **mutation**, **flake**, and the run-mode **worktree · safe**. Checking one
     appends its flag (`--euphony`, `--worktree`, …).
   - **Check `worktree · safe` for any dogfood run** — it runs in a throwaway git
     worktree so the target's live tree is never edited (no `git checkout` after).
4. **Run** — click `.chat-signal .chat-run-btn`. One run at a time (the row locks).
   A **⏹ cancel** button appears in the live region; click it to SIGTERM the run
   and unlock the tab (a cancelled worktree run leaves a worktree — `git worktree
   remove --force <path>` to prune; the daemon log names it).
5. **Watch** the live pipeline region:
   - `.chat-pipeline .chat-rune` — the rune strip; classes `s-idle|s-active|s-ok|s-err`
     show which phase/gate is running, retrying, done, or blocking.
   - `.chat-status` — active `step N · tool`, or `blocked at <gate> · <reason>`, + tokens.
   - `#chat-convo` — the transcript streams live (chain of thought + tool calls/
     results; long turns clamp with "show more").
   - `.chat-note` — advisory rune reports (e.g. `♪ euphony 50/100 · …`, or the
     `⚠ validation: 0 tests collected` cognitive-check note) surface here on stop.
6. **Finish** — a conversation line `run finished — <accepted|difficulty|max_steps|…>`;
   `.chat-status` shows `accepted — all gates green` when it accepts. **Proposals**
   (`.chat-signal.chat-prop`) then appear in signals — each a one-click follow-up
   (pick a model + gates + run) to iterate.

Screenshot after the plan card and after the run (`browser_take_screenshot`) and
eyeball it — the tab is the artifact under test.

### Worked recipes (NL phrasing that classifies right)

The $0 interpret keys off verbs — phrase the request so it lands on the op you want:

| Want | Type into `#chat-prompt` | Lands on |
|---|---|---|
| add unit tests | "add unit tests for the parser" | `generate` |
| add a feature (TDD) | "add a `clamp(x,lo,hi)` helper to the geometry" | `feature` |
| refactor safely | "refactor the giant App component for clarity" | `refactor` |
| repair stale tests | "the tests broke after my change — repair them" | `repair` |
| fix a described bug | "fix: dates render a day early in the picker" | `fix` |

Reliable accept: pick a **single-package** target + a capable model + `worktree ·
safe`. `feature` wants a NEW function whose test file doesn't already exist (an
existing test collides with `no_regression`).

### Troubleshooting

| Symptom | What it means / do |
|---|---|
| run finished — **difficulty** | model gave up circling. Read the proposal in the conversation; usually: switch to a stronger model, or split the target. |
| run finished — **misconfigured** | a gate hit an unfixable-by-code condition (the honest-stop channel). The proposal names it: 0 tests collected (monorepo scope) or an environment error (missing dep). Fix the config/toolchain, not the code. |
| `⚠ validation: 0 tests collected` note | the runner didn't discover the new spec — a scope/config mismatch (often a monorepo run at the repo root). Prefer a single-package target. |
| `⚠ validation: … environment error` note | the suite couldn't execute (missing binary/dep/network). Install the dep; not a code failure. |
| weak model thrashes / never edits | switch to `ollama:qwen3.5:397b` / sonnet / opus, or drive `bridge` + probevane-brain (Fallback). |
| tab frozen on an old run's status | shouldn't happen (`/stream` is mtime-scoped) — reload the tab. |

## 3. History (past runs)

`#chat-history` (⟲ HISTORY) lists the current dir's past runs (`.chat-hrun`:
op · verdict · steps · model · date), searchable (`.chat-hsearch`) + "load more".
Click one to load its full transcript into `#chat-convo`, bracketed by `▾/▴`
dividers. Use this to confirm a prior accept or review what a run did.

## 4. Verify e2e (the dogfood goal)

A run is genuinely done when: the pipeline strip is all `s-ok` and `.chat-status`
reads **accepted — all gates green**; the transcript shows a real red→green→finish;
and any opt-in note (euphony score, etc.) rendered. If it stops on **difficulty**
or **misconfigured**, read the proposal in the conversation — it names why (the
cognitive checks distinguish "0 tests collected — scope/config" and "environment
error" from a real code failure, and stop honestly instead of thrashing).

## 5. Key selectors (for `browser_evaluate`)

| What | Selector |
|---|---|
| Assistant tab button | `nav.tabs button[data-go="chat"]` |
| project path input | `#chat-dir` (datalist `#chat-dirs`) |
| prompt input / send | `#chat-prompt` / `#chat-send` |
| plan / proposal card | `.chat-signal` / `.chat-signal.chat-prop` |
| model select | `.chat-signal .chat-model` |
| gate + run-mode toggles | `.chat-signal .chat-gate input` (euphony/quality/mutation/flake/worktree) |
| RUN button | `.chat-signal .chat-run-btn` |
| CANCEL button | `#chat-tools .chat-cancel` (visible only during a run) |
| pipeline runes | `#chat-tools .chat-pipeline .chat-rune` (`.s-idle/active/ok/err`) |
| live status | `#chat-tools .chat-status` |
| rune notes | `#chat-tools .chat-note` |
| transcript turns | `#chat-convo .turn` |
| history button | `#chat-history` |
| past-run cards | `.chat-hrun` (search `.chat-hsearch`) |

## 6. Gotchas (learned dogfooding this project)

- **Rebuild dist + restart** to pick up ANY code change — the daemon serves `dist/`,
  not `src/` (unless `PROBEVANE_UI_DEV=1`, which only recompiles the UI, not the loop).
- **Monorepo targets** can make the harness run the test command at the repo root →
  0 tests collected → the run can't accept. validation_gate now NAMES this
  ("0 tests collected — scope/config"), but prefer a **single-package** target
  (e.g. `fixtures/node-calc`) for a reliable accept.
- **Weak models give up** (`difficulty`): bare `ollama` (kimi) and small models
  thrash on big repos. Pick `ollama:qwen3.5:397b` / sonnet / opus, or —
- **For a guaranteed $0 accept**, use `--model bridge` and service it with the
  **probevane-brain** skill/agent (it writes correct code first-try → gates green).
  Bridge isn't in the tab's model list (a headless daemon has no servicer), so
  launch a bridge run via `POST /run` (see Fallback) and spawn `probevane-brain`.
- The live regions track the **current** run (`/stream` is mtime-scoped), so a
  busy project dir no longer freezes the tab on an old run.
- The tab does NOT show run stdout — tail the daemon log for `[euphony]`, engine
  steps, and give-up proposals when debugging.
- **worktree runs + cancel** leave a stray git worktree if cancelled mid-run (the
  SIGTERM'd child can't clean up) — `git worktree remove --force <path>` (the path
  is in the daemon log). A run that finishes on its own cleans up normally.

## 7. Fallback to the CLI (only when the GUI can't)

The tab now drives `--worktree` (the "worktree · safe" toggle) and cancel. It still
can't express: `bridge`, `--only <target>`, `--force-stop-after`, `--worktree-merge`,
or non-loop commands (`arch`, `quality`, `review`, `ship`, `spec`, `mutation`,
`euphony`). For those, launch through the daemon's `/run` (same endpoint the tab
uses) or the CLI, then watch it in the tab (open the Assistant tab on that dir —
`/stream` picks up the current run):

```sh
curl -s -X POST http://localhost:7766/run -H 'content-type: application/json' \
  -d '{"op":"feature","dir":"<dir>","flags":["--task","<nl task>","--model","bridge","--euphony","--max-steps","20"]}'
```
or `./bin/probevane <command> <dir> [flags]` (see the generated `probevane` skill).
Prefer the GUI for everything it can drive; drop to CLI for the rest, then verify
the outcome back in the tab via ⟲ HISTORY.

**Inspect naming euphony without a run** — `./bin/probevane euphony <dir>` prints a
project's function-name rhyme + meter, per file + overall ($0, no model). Handy to
sanity-check the euphony gate's read or just to see a codebase's naming music.

## Validated

Dogfooded end-to-end, zero CLI fallback: opened the Assistant tab → set
`fixtures/node-calc` → NL task → SEND ($0 `feature` plan) → picked
`ollama:qwen3.5:397b` + checked the **euphony** toggle → RUN → watched the live
pipeline + streaming transcript (TDD red→green; the model even recovered from
hallucinating a `run_shell` tool) → §4 verified ACCEPTED: all runes `s-ok`,
`accepted — all gates green`, and the `♪ euphony 20/100` note rendered. Ledger:
`feature:node-calc qwen3.5:397b accepted 10`. The single-package target + a
capable model gave the reliable accept the Gotchas prescribe.
