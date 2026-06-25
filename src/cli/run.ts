import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import type { RunScope } from '../adapters/adapter.js';

// probevane run <dir> [--scope unit|e2e|all]
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const scope = (flag(args, '--scope') as RunScope) ?? 'unit';

  const adapter = await selectAdapterOrThrow(dir);
  console.error(`[probevane] adapter=${adapter.id} scope=${scope} dir=${dir}`);
  const r = await adapter.run(dir, scope);
  console.log(
    `[probevane] ${r.green ? 'GREEN' : 'RED'}  passed=${r.passed} failed=${r.failed} skipped=${r.skipped}`,
  );
  if (!r.green) {
    console.error(r.raw.slice(-2000));
    process.exit(1);
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
