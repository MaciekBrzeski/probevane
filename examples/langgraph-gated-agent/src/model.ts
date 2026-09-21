import { AIMessage, type BaseMessage } from "@langchain/core/messages";

/** The one interface both the offline stub and a real LangChain chat model satisfy. */
export interface Model {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}

/**
 * Deterministic offline stub that behaves like an LLM: it writes a WEAK test
 * first (no assertions), then — once the gate feeds a critique back — a STRONG
 * one. Lets the whole gated loop run with zero API cost, so CI is free.
 */
export function stubModel(): Model {
  return {
    async invoke(messages) {
      const text = messages.map((m) => String(m.content)).join("\n");
      if (text.includes("Write a test plan")) {
        return new AIMessage("1. add(2,3) === 5\n2. add(-1,1) === 0");
      }
      if (!text.includes("CRITIQUE:")) {
        return new AIMessage("test('add', () => { add(2, 3); });"); // weak: no expect()
      }
      return new AIMessage(
        "test('add sums', () => { expect(add(2, 3)).toBe(5); });\n" +
          "test('add zero', () => { expect(add(-1, 1)).toBe(0); });",
      );
    },
  };
}

/** Optional: the same agent driven by a real LangChain chat model over local Ollama. */
export async function ollamaModel(model = "qwen2.5-coder:14b"): Promise<Model> {
  const { ChatOllama } = await import("@langchain/ollama");
  const llm = new ChatOllama({ model, temperature: 0 });
  return { invoke: (messages) => llm.invoke(messages) as Promise<AIMessage> };
}
