import assert from "node:assert";
import { createGatedAgent } from "./agent.js";
import { stubModel } from "./model.js";

// Offline smoke: the gate should reject the weak first draft, force a revision,
// then accept — proving the LangGraph loop actually cycles.
const agent = createGatedAgent(stubModel());
const out = await agent.invoke({ code: "function add(a, b) { return a + b; }" });

assert.equal(out.verdict, "accept", "should accept after revising");
assert.ok(out.revisions >= 2, "should have revised at least once");
assert.match(out.tests, /expect\(/, "accepted tests must contain assertions");
console.log(`ok — gated agent accepted after ${out.revisions} revisions`);
