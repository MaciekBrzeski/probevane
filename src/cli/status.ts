import { resolve } from 'node:path';
import { selectAdapter } from '../adapters/registry.js';

// probevane status <dir> — quick dashboard: adapter, run result, coverage.
async function main() {
  const dir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.');
  const adapter = await selectAdapter(dir);
  if (!adapter) {
    console.log('[probevane] no adapter matched this directory');
    return;
  }
  console.log(`adapter:  ${adapter.id}`);
  const r = await adapter.run(dir, 'unit');
  console.log(`unit:     ${r.green ? 'green' : 'red'} (passed=${r.passed} failed=${r.failed} skipped=${r.skipped})`);
  const c = await adapter.coverage(dir).catch(() => null);
  if (c?.ok) console.log(`coverage: statements=${c.statements}% lines=${c.lines}%`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
