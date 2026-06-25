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

- **complex** → start on **Sonnet** (primary), escalate to **Opus** on stall.
- **simple** → start on **Haiku**, escalate to **Sonnet**.

So complex code goes to the stronger model *up front* instead of wasting Haiku steps before takeover. Override with `--model haiku|sonnet|opus|<id>` or `--takeover <id>`. Observed: react-todo/shop/tip → Haiku; a 46-module redux+axios+router app → Sonnet.

## Takeover

When the loop stalls **after it has started editing** (`barren ≥ consultAfter`), the consult ladder escalates once: it injects extra guidance (a known-good library exemplar via `onConsult`) and, if a `takeoverBrain` is set, hands the window to a stronger model (`--takeover`, default `claude-sonnet-4-6`) — still under all gates. `forceStopAfter` is the final give-up.

Escalation only counts non-edit turns **after the first productive edit** — initial reading/planning is legitimate work, not a stall (runestone's force_stop lesson). Proven: on a clean fresh-app run Haiku finishes alone (no takeover); when genuinely stuck, Sonnet takes over and reaches a clean accept.

## Cost note

P1 trivial unit run on the todo fixture: ~19k input / ~3k output tokens over 7 steps. Input dominates (re-sent transcript). Prompt caching + bash-output capping (runestone's big self-host lever) are future optimizations.
