import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { Model } from "./model.js";

const MAX_REVISIONS = 3;

/** Graph state (LangGraph channels). */
const S = Annotation.Root({
  code: Annotation<string>(),
  plan: Annotation<string>(),
  tests: Annotation<string>(),
  critique: Annotation<string>(),
  revisions: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  verdict: Annotation<string>(),
});
type State = typeof S.State;

/**
 * probevane's philosophy in miniature: accept only when the tests are REAL.
 * Here the gate is deterministic (must assert with expect(), must call the fn);
 * in probevane the equivalent gate actually runs the suite + audits it.
 */
function gate(tests: string, code: string): { pass: boolean; critique: string } {
  if (!/expect\s*\(/.test(tests)) {
    return { pass: false, critique: "No assertions — every test must assert with expect()." };
  }
  const fn = code.match(/function\s+(\w+)/)?.[1];
  if (fn && !tests.includes(fn)) {
    return { pass: false, critique: `Tests never call ${fn}().` };
  }
  return { pass: true, critique: "" };
}

/** Build the compiled LangGraph agent: plan → generate → validate ↺ (gated). */
export function createGatedAgent(model: Model) {
  const planNode = async (s: State) => {
    const r = await model.invoke([
      new SystemMessage("You are a test engineer."),
      new HumanMessage(`Write a test plan for this code.\n\nCODE:\n${s.code}`),
    ]);
    return { plan: String(r.content) };
  };

  const generateNode = async (s: State) => {
    const critique = s.critique ? `\nCRITIQUE: ${s.critique}\nFix it and re-emit.` : "";
    const r = await model.invoke([
      new SystemMessage("Write vitest tests. Output only code."),
      new HumanMessage(`CODE:\n${s.code}\n\nPLAN:\n${s.plan}${critique}`),
    ]);
    return { tests: String(r.content), revisions: s.revisions + 1 };
  };

  const validateNode = async (s: State) => {
    const { pass, critique } = gate(s.tests, s.code);
    return { verdict: pass ? "accept" : "revise", critique };
  };

  // Conditional edge = the loop's decision: ship, revise, or give up.
  const route = (s: State): "accept" | "revise" | "giveup" =>
    s.verdict === "accept" ? "accept" : s.revisions >= MAX_REVISIONS ? "giveup" : "revise";

  return new StateGraph(S)
    .addNode("planner", planNode)
    .addNode("writer", generateNode)
    .addNode("gate", validateNode)
    .addEdge(START, "planner")
    .addEdge("planner", "writer")
    .addEdge("writer", "gate")
    .addConditionalEdges("gate", route, { accept: END, revise: "writer", giveup: END })
    .compile();
}
