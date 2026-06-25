import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sh } from '../util/exec.js';
import type { MockPlan } from './index.js';
import type { ModuleGraph } from './graph.js';

// Chaining — a module's OUTPUT becomes the next module's INPUT fixture.
//
//   1. materializeFixtures: each fetcher's response sample is written ONCE to
//      test-fixtures/<name>.json and handlers.ts imports it → a single frozen
//      source of truth that flows through every consumer.
//   2. captureContracts: pure transformer modules are executed over those
//      fixtures (in the project, via tsx) and their outputs frozen as contracts.
//      A downstream test asserts the SAME upstream output, not a re-mock.

export interface Contracts {
  fixtures: Record<string, unknown>; // name -> frozen input fixture (fetcher output)
  outputs: Record<string, unknown>; // "module#fn" -> captured output
}

const FIXT_DIR = 'test-fixtures';

export async function materializeFixtures(dir: string, plan: MockPlan): Promise<Record<string, unknown>> {
  const fixtures: Record<string, unknown> = {};
  for (const h of plan.handlers) {
    if (Array.isArray(h.sample) && h.sample.length) {
      const name = fixtureName(h.urlPattern); // /api/products -> products
      if (!fixtures[name]) fixtures[name] = h.sample;
    }
  }
  await mkdir(join(dir, FIXT_DIR), { recursive: true });
  for (const [name, val] of Object.entries(fixtures))
    await writeFile(join(dir, FIXT_DIR, `${name}.json`), JSON.stringify(val, null, 2) + '\n');
  return fixtures;
}

/** Run each pure (util) module's exported functions over the fixtures, in-project via tsx. */
export async function captureContracts(
  dir: string,
  graph: ModuleGraph,
  fixtures: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const utilMods = [...graph.nodes.values()].filter((n) => n.kind === 'util' && !n.callsNetwork);
  if (utilMods.length === 0 || Object.keys(fixtures).length === 0) return {};

  const harness = buildHarness(utilMods.map((n) => n.path), fixtures);
  const harnessPath = join(dir, '.probevane-capture.mjs');
  await writeFile(harnessPath, harness);
  const r = await sh(`npx tsx ${harnessPath}`, dir, 60_000);
  await rm(harnessPath).catch(() => {});
  try {
    const start = r.stdout.indexOf('__CONTRACTS__');
    const json = r.stdout.slice(start + '__CONTRACTS__'.length).trim();
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export async function writeContracts(dir: string, contracts: Contracts): Promise<void> {
  await mkdir(join(dir, FIXT_DIR), { recursive: true });
  await writeFile(join(dir, FIXT_DIR, 'contracts.json'), JSON.stringify(contracts, null, 2) + '\n');
}

export async function readContracts(dir: string): Promise<Contracts | null> {
  return readFile(join(dir, FIXT_DIR, 'contracts.json'), 'utf8')
    .then((s) => JSON.parse(s) as Contracts)
    .catch(() => null);
}

// --- helpers --------------------------------------------------------------

function fixtureName(urlPattern: string): string {
  const parts = urlPattern.split('/').filter((p) => p && !p.startsWith(':'));
  return parts[parts.length - 1] || 'data';
}

// A tiny ESM harness: import each util module + the fixtures, call every
// exported function with the array fixture that fits its first parameter, and
// print the outputs. Best-effort — functions that don't take the array are skipped.
function buildHarness(modulePaths: string[], fixtures: Record<string, unknown>): string {
  const fixtureLiteral = JSON.stringify(fixtures);
  const imports = modulePaths
    .map((p, i) => `import * as m${i} from './${p.replace(/\.[tj]sx?$/, '.js')}';`)
    .join('\n');
  const mods = modulePaths.map((p, i) => `[${JSON.stringify(p)}, m${i}]`).join(', ');
  return `${imports}
const FIX = ${fixtureLiteral};
const fixtureArrays = Object.values(FIX).filter(Array.isArray);
const out = {};
const bad = (v) => { const s = JSON.stringify(v); return s === undefined || s.includes('NaN') || s.includes('Infinity'); };
for (const [path, mod] of [${mods}]) {
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== 'function') continue;
    // Only capture transformers that accept the collection fixture (one array arg).
    if (fn.length !== 1) continue;
    for (const arr of fixtureArrays) {
      try {
        const res = fn(arr);
        // keep only sensible outputs (array/object), not scalars from a type mismatch
        if (res !== undefined && !bad(res) && typeof res === 'object') { out[path + '#' + name] = res; break; }
      } catch {}
    }
  }
}
console.log('__CONTRACTS__' + JSON.stringify(out));
`;
}
