import { join, relative } from 'node:path';
import { pathExists } from '../util/fs.js';
import { readFile, readdir } from 'node:fs/promises';
import { readFederation } from './scan.js';
import {
  remoteContractTest,
  hostContractTest,
  exposeName,
  type ContractFile,
  type ContractType,
} from './contract.js';

// I/O for federation contract-test generation (Phase C). Reads a repo's federation
// config, resolves the typed-contract source (auto-detect: a *-contracts package →
// a sibling <expose>.contract.ts → else structural fallback), and plans the test
// files. Host-side tests are generated only when generated remote types
// (@mf-types/<remote>) are present to enumerate the remote's exposes. Excluded from
// coverage — the templating in contract.ts is the tested part.

const CONTRACT_DIR = join('tests', 'contract'); // where generated tests land

/** kebab/snake key → PascalCase, for contract type names (cart-widget → CartWidget). */
function pascal(s: string): string {
  return s.replace(/(^|[-_])([a-z])/g, (_, __, c) => c.toUpperCase());
}

/** Resolve a typed contract for an exposed key, or undefined (→ structural test). */
async function resolveContract(
  dir: string,
  key: string,
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
): Promise<ContractType | undefined> {
  const nm = exposeName(key);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const contractsPkg = Object.keys(deps).find((d) => /-contracts$/.test(d));
  if (contractsPkg) return { name: `${pascal(nm)}Contract`, from: contractsPkg };
  // A sibling contract file under src/, e.g. src/Cart.contract.ts.
  const base = key.replace(/^\.\//, '').replace(/\.[tj]sx?$/, '');
  if (await pathExists(join(dir, 'src', `${base.split('/').pop()}.contract.ts`)))
    return { name: `${pascal(nm)}Contract`, from: `../../src/${base.split('/').pop()}.contract` };
  return undefined;
}

/** The planned contract-test output: files to write + human-facing notes (missing
 *  types, skipped hosts). Filled by planContracts, consumed by the driver/CLI. */
export interface ContractPlan {
  files: { path: string; content: string; typed: boolean }[];
  notes: string[];
}

/** Plan the repo's contract tests: one remote-side test per expose, host-side tests
 *  per remote with @mf-types; null when the repo has no federation config. */
export async function planContracts(dir: string): Promise<ContractPlan | null> {
  const config = await readFederation(dir);
  if (!config) return null;
  const pkg = await readFile(join(dir, 'package.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  const out: ContractPlan = { files: [], notes: [] };
  const testDir = join(dir, CONTRACT_DIR);

  // Remote side: each exposed module must conform to its contract.
  for (const [key, srcPath] of Object.entries(config.exposes)) {
    const contract = await resolveContract(dir, key, pkg);
    const importPath = relative(testDir, join(dir, srcPath.replace(/^\.\//, ''))).replace(/\.[tj]sx?$/, '');
    const cf = remoteContractTest(config.name, key, importPath.startsWith('.') ? importPath : './' + importPath, contract);
    out.files.push({ path: join(testDir, cf.file), content: cf.content, typed: cf.typed });
    if (!cf.typed) out.notes.push(`expose "${key}" has no typed contract — publish a *-contracts pkg or a ${key}.contract.ts for a compile-time check`);
  }

  // Host side: only when generated remote types are present to enumerate exposes.
  for (const remote of config.remotes) {
    const candidates = [join(dir, '@mf-types', remote), join(dir, 'node_modules', '@mf-types', remote)];
    const real = (await Promise.all(candidates.map(async (p) => ((await pathExists(p)) ? p : null)))).find(Boolean);
    if (!real) {
      out.notes.push(`host remote "${remote}": no @mf-types found — run @module-federation/typescript (or add a contracts pkg) to generate host contract tests`);
      continue;
    }
    const dts = (await readdir(real).catch(() => [])).filter((f) => f.endsWith('.d.ts'));
    for (const f of dts) {
      const key = './' + f.replace(/\.d\.ts$/, '');
      const nm = exposeName(key);
      const contract: ContractType = { name: `${pascal(nm)}`, from: `@mf-types/${remote}/${f.replace(/\.d\.ts$/, '')}` };
      const cf: ContractFile = hostContractTest(config.name, remote, key, contract);
      out.files.push({ path: join(testDir, cf.file), content: cf.content, typed: cf.typed });
    }
  }

  return out;
}

export { CONTRACT_DIR };
