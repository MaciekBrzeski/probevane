import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';

// probevane coverage <dir>
async function main() {
  const dir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.');
  const adapter = await selectAdapterOrThrow(dir);
  const c = await adapter.coverage(dir);
  if (!c.ok) {
    console.error('[probevane] coverage unavailable');
    console.error((c.raw ?? '').slice(-1500));
    process.exit(1);
  }
  console.log(
    `[probevane] coverage statements=${c.statements}% branches=${c.branches}% functions=${c.functions}% lines=${c.lines}%`,
  );
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
