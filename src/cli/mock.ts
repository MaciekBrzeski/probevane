import { resolve } from 'node:path';
import { buildChain } from '../mock/index.js';

// probevane mock <dir> — build the module graph, synthesize the mock boundary
// (network → MSW handlers, dep mocks, prop fixtures), materialize shared
// fixtures, capture transformer output contracts, and write everything to disk.
async function main() {
  const dir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.');
  const plan = await buildChain(dir);
  console.log(
    `[probevane] graph: ${plan.graph.order.length} modules; ${plan.handlers.length} endpoint(s); ` +
      `${Object.keys(plan.fixtures ?? {}).length} fixture(s); ${Object.keys(plan.outputs ?? {}).length} contract(s)`,
  );
  console.log('\n' + plan.digest);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
