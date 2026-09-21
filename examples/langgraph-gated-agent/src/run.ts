import { createGatedAgent } from "./agent.js";
import { stubModel, ollamaModel } from "./model.js";

const useOllama = process.argv.includes("--ollama");
const model = useOllama ? await ollamaModel() : stubModel();

const code = "function add(a, b) { return a + b; }";
const agent = createGatedAgent(model);
const out = await agent.invoke({ code });

console.log("── plan ──\n" + out.plan);
console.log(`\n── result ──  revisions=${out.revisions}  verdict=${out.verdict}`);
console.log("\n── tests ──\n" + out.tests);
