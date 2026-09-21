# LangGraph gated test-writing agent

A small, self-contained example that rebuilds **probevane's core idea** — *an LLM
may only finish once its tests are real* — on **[LangGraph.js](https://langchain-ai.github.io/langgraphjs/)**
and **[LangChain.js](https://js.langchain.com/)**.

It's a `StateGraph` with a feedback loop:

```
        ┌──────── revise ◄────────┐
START → planner → writer → gate ──┤
                                  └──── accept / giveup ──► END
```

- **planner** — the model drafts a test plan from the code.
- **writer** — the model writes vitest tests (re-emitting when the gate sends a critique).
- **gate** — a deterministic acceptance check (must assert with `expect()`, must call the
  function). This is probevane's `validation_gate` / `audit_gate` in miniature; in the real
  harness the gate actually runs and audits the suite.
- **conditional edge** — `accept` → END, `revise` → back to writer, `giveup` after `MAX_REVISIONS`.

## Run

```sh
npm install
npm test        # offline: proves the loop rejects a weak draft, revises, then accepts
npm start       # same, with printed plan + tests (deterministic stub model, $0)
npm start:ollama # drive it with a real LangChain ChatOllama model (local, needs ollama)
```

The model sits behind one `Model` interface (`src/model.ts`): a **deterministic stub** for
zero-cost offline runs/CI, or **`ChatOllama`** from `@langchain/ollama` for a live local LLM —
so the graph logic is identical whether it's a fake or a real model.

## Why it exists

probevane has its own hand-rolled gated loop and LLM "brain". This example expresses the same
pattern with LangGraph's `StateGraph` + conditional edges and LangChain message/model
abstractions — a compact, idiomatic demonstration of both libraries on probevane's home turf.
