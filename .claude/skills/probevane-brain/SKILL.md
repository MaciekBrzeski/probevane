---
name: probevane-brain
description: Act as the model ("brain") for a probevane bridge run — drive its gated test-writing loop from subagents inside THIS Claude Code session at $0 API cost, instead of the Anthropic API. Use when asked to run probevane with `--model bridge`, "service the bridge", or "drive probevane from here / for free / via subagents".
---

# probevane-brain (bridge servicer)

probevane's loop talks to a `Brain` (`complete(req) → {text, toolCalls}`). The **bridge** brain (`--model bridge`) doesn't call the API — it writes each turn's request to a file and blocks, expecting the **host session** (you) to service it with a subagent. This drives the full gated loop (plan → write → validate → audit → accept) using **your exact prompt, billed to this session, $0 API**. Proven: a 4-turn bridge run → ACCEPTED, 14 type-clean tests, $0.0000.

> Trade-off: NOT autonomous — you are the model server, one subagent services the run. Consumes session/subscription tokens (not API credits). Use when free-vs-API matters more than hands-off.

## Protocol

Queue dir: `~/.local/share/probevane/bridge/` (override `PROBEVANE_BRIDGE_DIR`).
- probevane writes `req-<n>.json` = `{ system, messages, tools:[{name,description,input_schema}] }` — the same shape it would POST to `/v1/messages`.
- You write `res-<n>.json` = `{ "text"?: string, "tool_calls": [{"name","input"}], "costUsd"?: number }`. Empty `tool_calls` = stop (let the gates run).

## Steps

1. **Clear the queue:** `rm -rf ~/.local/share/probevane/bridge && mkdir -p ~/.local/share/probevane/bridge`
2. **Launch probevane in the BACKGROUND** (run_in_background Bash), bounded:
   ```
   cd <project> && ./bin/probevane generate <dir> --model bridge --kind unit --only <module> --max-steps 8 > /tmp/bridge-run.log 2>&1
   ```
   `--model bridge` keeps takeover on bridge too (no paid fallback). Scope with `--only <module>` to bound cost; drop it to test all targets.
3. **Spawn ONE servicer subagent** (general-purpose) with the prompt below. It polls the queue and services every turn until the run ends.
4. **Read the verdict:** `grep -E "ACCEPTED|OUTCOME" /tmp/bridge-run.log` and `./bin/probevane history --limit 1` (cost shows $0 for bridge).

## Servicer subagent prompt (template)

> You are the MODEL ("brain") for probevane, running in the background. Service its bridge queue at `~/.local/share/probevane/bridge/`.
>
> Loop until done:
> 1. Poll for the lowest `req-N.json` with no matching `res-N.json` (`sleep 2` between checks).
> 2. Read it: `{system (probevane instructions + GROUND TRUTH + task), messages (transcript: task, prior assistant tool_calls, prior tool results / gate feedback), tools (schemas)}`.
> 3. Act as the API model with tool use — decide the SINGLE next step. Typical arc: `read_file` source → `plan` (record test plan) → `write_file` the spec → on gate feedback, `edit_file` to fix → when gates should pass, stop (empty tool_calls). You MAY read the real source under `<project>` to make the `write_file` `contents` correct + type-clean. Tests are <stack> (e.g. vitest: `import { describe, it, expect } from 'vitest'`), placed per the system's placement guidance. Import real exports, assert concrete values, cover edge+error. Do NOT modify source. ONE tool call per turn.
> 4. Write `res-N.json` = `{ "text": "<brief>", "tool_calls": [{"name","input"}] }` (one Write call, atomic). To finish: `{ "tool_calls": [] }`.
> 5. Stop servicing when: you emitted a stop AND no new req for ~20s, OR no new req for 40s (bg exited), OR you serviced 10 requests.
>
> Report: turns serviced, tool calls issued, whether a real test file was written.

## Notes
- Mirror `--kind`/stack in the servicer prompt (placement + imports differ per stack).
- For multi-target runs, raise `--max-steps` and the servicer's request cap.
- If the servicer stalls, check `/tmp/bridge-run.log` — probevane logs each `[engine] step` and gate block; feed those back via the next `res`.
