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

```sh
cd <probevane>            # e.g. /home/wruszbit/Dokumenty/probevane
npm run build             # esbuild → dist/ (skip if only exercising, not changing)
# kill the old daemon on :7766, then:
nohup node dist/cli/daemon.js --port 7766 >~/.local/share/probevane/daemon-7766.log 2>&1 & disown
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7766/   # expect 200
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
3. **Model + gates** — on the plan card's run row:
   - model: `select.chat-model` (auto / haiku / sonnet / opus / ollama:* — pick a
     capable one; weak models give up, see Gotchas).
   - opt-in gate toggles: `.chat-gate input` checkboxes — **euphony**, **quality**,
     **mutation**, **flake**. Checking one appends its flag (`--euphony` etc.).
4. **Run** — click `.chat-signal .chat-run-btn`. One run at a time (the row locks).
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

## 3. History (past runs)

`#chat-history` (⟲ HISTORY) lists the current dir's past runs (`.chat-hrun`:
op · verdict · steps · model · date), searchable (`.chat-hsearch`) + "load more".
Click one to load its full transcript into `#chat-convo`, bracketed by `▾/▴`
dividers. Use this to confirm a prior accept or review what a run did.

## 4. Verify e2e (the dogfood goal)

A run is genuinely done when: the pipeline strip is all `s-ok` and `.chat-status`
reads **accepted — all gates green**; the transcript shows a real red→green→finish;
and any opt-in note (euphony score, etc.) rendered. If it stops on **difficulty**,
read the proposal in the conversation — it names why (and the new cognitive check
names "0 tests collected" as a scope/config problem, not a code failure).

## 5. Key selectors (for `browser_evaluate`)

| What | Selector |
|---|---|
| Assistant tab button | `nav.tabs button[data-go="chat"]` |
| project path input | `#chat-dir` (datalist `#chat-dirs`) |
| prompt input / send | `#chat-prompt` / `#chat-send` |
| plan / proposal card | `.chat-signal` / `.chat-signal.chat-prop` |
| model select | `.chat-signal .chat-model` |
| gate toggles | `.chat-signal .chat-gate input` (euphony/quality/mutation/flake) |
| RUN button | `.chat-signal .chat-run-btn` |
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

## 7. Fallback to the CLI (only when the GUI can't)

The tab can't (yet) express: `--worktree` isolation, `bridge`, `--only <target>`,
`--force-stop-after`, or non-loop commands (`arch`, `quality`, `review`, `ship`,
`spec`, `mutation`). For those, launch through the daemon's `/run` (same endpoint
the tab uses) or the CLI, then watch it in the tab (open the Assistant tab on that
dir — `/stream` picks up the current run):

```sh
curl -s -X POST http://localhost:7766/run -H 'content-type: application/json' \
  -d '{"op":"feature","dir":"<dir>","flags":["--task","<nl task>","--model","bridge","--euphony","--max-steps","20"]}'
```
or `./bin/probevane <command> <dir> [flags]` (see the generated `probevane` skill).
Prefer the GUI for everything it can drive; drop to CLI for the rest, then verify
the outcome back in the tab via ⟲ HISTORY.
