import { buildGraph, type ModuleGraph } from './graph.js';
import { synthForModule, loadOpenapi, type MockBundle, type HandlerSpec } from './synth.js';
import { materializeFixtures, captureContracts, writeContracts } from './contract.js';
import { writeMocks } from './store.js';

export type { MockBundle, HandlerSpec } from './synth.js';
export type { ModuleGraph, ModuleNode } from './graph.js';
export { buildGraph } from './graph.js';

/** The whole-app mock plan handed to test generation. Filled by buildMockPlan;
 *  buildChain enriches it with frozen fixtures + captured transformer outputs. */
export interface MockPlan {
  graph: ModuleGraph;
  bundles: MockBundle[]; // one per module, in topological order
  handlers: HandlerSpec[]; // deduped across the app
  digest: string; // injected into generation
  fixtures?: Record<string, unknown>; // chain: frozen upstream outputs
  outputs?: Record<string, unknown>; // chain: captured transformer outputs
}

/** Build the whole-app mock plan: graph → per-module synthesis → deduped handlers. */
export async function buildMockPlan(dir: string): Promise<MockPlan> {
  const graph = await buildGraph(dir);
  const openapi = await loadOpenapi(dir);
  const bundles: MockBundle[] = [];
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    bundles.push(await synthForModule(dir, node, graph, openapi));
  }

  const handlers: HandlerSpec[] = [];
  for (const b of bundles)
    for (const h of b.handlers)
      if (!handlers.some((x) => x.method === h.method && x.urlPattern === h.urlPattern)) handlers.push(h);

  const digest = [
    `MOCK PLAN (${bundles.length} modules, ${handlers.length} network endpoints):`,
    ...bundles.filter((b) => b.handlers.length || b.depMocks.length || b.props).map((b) => b.digest),
  ].join('\n\n');

  return { graph, bundles, handlers, digest };
}

/**
 * Full chain build: synthesize the plan, materialize fetcher outputs as shared
 * fixtures, capture pure-transformer outputs over them, write MSW handlers (that
 * import the fixtures) + contracts.json. Returns the plan enriched with the
 * chain so generation can assert each module against its upstream's frozen output.
 */
export async function buildChain(dir: string): Promise<MockPlan> {
  const plan = await buildMockPlan(dir);
  const fixtures = await materializeFixtures(dir, plan);
  const outputs = await captureContracts(dir, plan.graph, fixtures);
  await writeContracts(dir, { fixtures, outputs });
  if (plan.handlers.length) await writeMocks(dir, plan.handlers, fixtures);

  const chainLines: string[] = [];
  if (Object.keys(fixtures).length) {
    chainLines.push('CHAIN — canonical fixtures (the frozen upstream outputs every consumer shares):');
    for (const [name, val] of Object.entries(fixtures))
      chainLines.push(`  test-fixtures/${name}.json = ${JSON.stringify(val).slice(0, 200)}`);
  }
  if (Object.keys(outputs).length) {
    chainLines.push('CHAIN — captured transformer outputs over those fixtures (assert these EXACT values):');
    for (const [k, val] of Object.entries(outputs))
      chainLines.push(`  ${k}(fixture) → ${JSON.stringify(val).slice(0, 200)}`);
  }
  const digest = chainLines.length ? `${plan.digest}\n\n${chainLines.join('\n')}` : plan.digest;
  return { ...plan, fixtures, outputs, digest };
}
