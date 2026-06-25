import type { StackAdapter } from './adapter.js';
import { reactAdapter } from './react-vitest-playwright/index.js';
import { pythonAdapter } from './python-pytest/index.js';
import { vueAdapter } from './vue-vitest-playwright/index.js';
import { goAdapter } from './go-test/index.js';
import { svelteAdapter } from './svelte-vitest/index.js';
import { nodeAdapter } from './node-vitest/index.js';
import { rustAdapter } from './rust-cargo/index.js';
import { angularAdapter } from './angular/index.js';

// Every known adapter. Order is irrelevant — selection is by detect() confidence.
export const ADAPTERS: StackAdapter[] = [reactAdapter, pythonAdapter, vueAdapter, goAdapter, svelteAdapter, nodeAdapter, rustAdapter, angularAdapter];

/** Pick the adapter with the highest detect() confidence for `dir`. */
export async function selectAdapter(dir: string): Promise<StackAdapter | null> {
  const scored = await Promise.all(
    ADAPTERS.map(async (a) => ({ a, score: await a.detect(dir).catch(() => 0) })),
  );
  scored.sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (!best || best.score <= 0) return null;
  return best.a;
}

export async function selectAdapterOrThrow(dir: string): Promise<StackAdapter> {
  const a = await selectAdapter(dir);
  if (!a) throw new Error(`probevane: no adapter matched ${dir} (known: ${ADAPTERS.map((x) => x.id).join(', ')})`);
  return a;
}
