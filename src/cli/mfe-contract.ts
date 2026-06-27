import { resolve, dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { planContracts } from '../mfe/contract-scan.js';

// probevane mfe-contract <dir> [--write] [--json]
//
// Generate Module Federation contract tests (MFE Phase C) — deterministic, $0:
//   - remote side: each exposed module must conform to its published contract
//     (compile-time), else a structural smoke (with a note to publish types).
//   - host side: consume each federated remote (mocked) against its contract —
//     emitted when generated remote types (@mf-types/<remote>) are present.
// Dry-run by default (lists planned files + notes); --write emits them.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const write = args.includes('--write');

  const plan = await planContracts(dir);
  if (!plan) {
    console.log('[probevane] mfe-contract: no Module Federation config found');
    return;
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  for (const f of plan.files) {
    if (write) {
      await mkdir(dirname(f.path), { recursive: true });
      await writeFile(f.path, f.content);
    }
    console.log(`${write ? 'wrote' : 'plan'}: ${f.path}  [${f.typed ? 'typed' : 'structural'}]`);
  }
  for (const n of plan.notes) console.log(`  note: ${n}`);
  console.log(
    `\n[probevane] mfe-contract: ${plan.files.length} test(s) (${plan.files.filter((f) => f.typed).length} typed)` +
      `${write ? ' written' : ' planned (--write to emit)'}, ${plan.notes.length} note(s)`,
  );
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
