# Brains

The **brain** is the LLM driver. The engine talks only to the `Brain` interface (`src/brain/brain.ts`), so swapping models or providers touches one file.

```ts
interface Brain {
  id: string;
  model: string;
  complete(req: { system, messages, tools }): Promise<BrainResponse>;
}
```

`BrainResponse = { text, toolCalls[], stopReason, usage }`. Transcript + tool types are provider-neutral (`src/loop/types.ts`); each brain maps them to/from its wire format, so the loop never imports a vendor SDK.

## anthropic-sdk (default)

`src/brain/anthropic-sdk.ts` — native Anthropic Messages API with tool use.

- Model: `claude-haiku-4-5-20251001` (override with `PROBEVANE_MODEL`). Haiku is fast + cheap and handles per-turn tool calls well.
- Auth: `ANTHROPIC_API_KEY` (bills API credits).
- **Retries** on 429/529/5xx with exponential backoff (≤5 tries) so rate limits don't kill a run — a runestone lesson (the per-minute input-TPM limit, not the budget, was the real blocker on self-host loops).

> Why not the Max plan via `claude -p`? Max can't do reliable per-turn tool calls, which the loop depends on. A `claude-code` brain remains a possible alternate driver for review/takeover.

## Auto model routing (`--model auto`, default)

Before the loop, `assessComplexity` scores the target code from the module graph + per-target testability cost: **large app** (≥25 modules +3, ≥15 +1), **networked** (+1), **redux/router-bound targets** (cost ≥5, +2). Score ≥3 → **complex**.

- **complex** → start on **Sonnet** (primary), takeover **Sonnet** (not Opus).
- **simple** → start on **Haiku**, takeover **Sonnet**.

Complex code goes to the stronger model *up front* instead of wasting Haiku steps before takeover. Override with `--model haiku|sonnet|opus|<id>` or `--takeover <id>`. **Takeover never auto-escalates to Opus** — the cost ledger showed Opus-takeover on already-stuck hard modules rarely converges and burns ~$1.20/run on re-sent input ($3.78 for 0 accepts in the self-coverage experiment); Opus is opt-in via `--model opus`. `bridge`/`claude-code`/`cc:*` keep takeover on themselves (never a paid Sonnet fallback).

## Takeover

When the loop stalls **after it has started editing** (`barren ≥ consultAfter`), the consult ladder escalates once: it injects extra guidance (a known-good library exemplar via `onConsult`) and, if a `takeoverBrain` is set, hands the window to a stronger model (`--takeover`, default `claude-sonnet-4-6`) — still under all gates. `forceStopAfter` is the final give-up.

Escalation only counts non-edit turns **after the first productive edit** — initial reading/planning is legitimate work, not a stall (runestone's force_stop lesson). Proven: on a clean fresh-app run Haiku finishes alone (no takeover); when genuinely stuck, Sonnet takes over and reaches a clean accept.

## Brain backends

The loop drives four brains behind one `Brain` interface — pick with `--model`:

| Brain | `--model` | Bills | Tool-calls | Use |
|---|---|---|---|---|
| **anthropic-sdk** | `haiku`/`sonnet`/`opus`/`auto` | API credits | native | default, real coverage |
| **openai-compat** | `local:<id>` | $0 (local GPU) | varies | local models via Ollama/vLLM (`PROBEVANE_BASE_URL`) |
| **claude-code** | `claude-code` / `cc:<m>` | per CLI auth | per-turn JSON | drives the loop via headless `claude -p` |
| **bridge** | `bridge` | $0 (host session) | per-turn | a **subagent in the host Claude Code session** services each turn over a filesystem queue (`probevane-brain` skill) |

**Transcript prompt caching** (done, not future): a second `cache_control` breakpoint sits on the stable, already-pruned transcript prefix (it only grows, never invalidates), on top of the system+tools breakpoint. Cuts re-sent-input cost — measured ~11% on a 15-step run, more on longer ones. `PROBEVANE_NO_TRANSCRIPT_CACHE=1` disables it. Every run is logged to the **cost ledger** (`~/.local/share/probevane/runs.jsonl`, see `probevane history`): tokens, real $ (cache-read at 0.1×), accepted/takeover, per-model/per-path.

## Local agent — what works, what doesn't (measured)

The bridge proved the working **$0 path**: a strong model (Claude, in-session) drives the full gated loop for free (subscription, not API) — 90 bridge runs, all $0, harvested 97 accepted traces across 8 stacks.

**A small *local* model can't drive the full loop.** A 3B/14B chokes on the dense multi-gate prompt and, given ground truth, **invents facts** (model IDs, rates, type shapes) — convention learned, facts not bound (confirmed across a distilled 3B LoRA, qwen3:14b, and tighter source-injection, which *backfired* on capacity). A specialist LoRA distilled from accepted traces ≈ base on easy modules (facts come via prompt/RAG), wins on hard modules only by compiling where base breaks — but neither fully passes hard modules solo. The gated **execute-verify-repair loop is the real lever**, not the adapter.

So local's role is the **convention-emitter**, precision-routed to the easy/pure band — see [the cost benchmark](#cost-benchmark).

### Cost benchmark

`probevane simcost [dir]` triages a codebase into easy (pure, low-fact → local-draftable) vs hard (fact-heavy/IO/component → bridge), and compares strategies over **measured** per-module costs (easy ≈ $0.16/mod haiku, hard ≈ $0.82/mod sonnet, bridge/local $0). Hybrid (`generate --hybrid`) drafts the easy band locally then bridges the rest. Its value **scales with the easy fraction × local hit-rate**:

| Codebase | all-api | hybrid | bridge |
|---|---|---|---|
| glue-heavy (2 easy / 122 hard) | $100 | $100 (−0%) | $0 |
| balanced (50 / 50) | $49 | $45 (−8%) | $0 |
| easy-heavy CRUD (80 / 20 @70% hit) | $29 | $20 (**−31%**) | $0 |

**Decision:** all-api for glue-heavy codebases; hybrid only pays on easy/pure-heavy ones (CRUD, util libs); bridge = $0 if you'll service it in-session.
