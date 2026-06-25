import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';

// probevane init <dir> — detect stack + install test deps/config (idempotent).
async function main() {
  const dir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.');
  const adapter = await selectAdapterOrThrow(dir);
  console.error(`[probevane] detected adapter=${adapter.id} dir=${dir}`);
  await adapter.install(dir);
  console.log(`[probevane] init complete — ${adapter.id} ready in ${dir}`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
