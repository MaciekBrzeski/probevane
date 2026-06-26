import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { isEasyTarget } from '../loop/triage.js';
import { formatReport, simulateCost, savings } from '../cost/simulate.js';

// probevane simcost [dir] [--easy N --hard M] [--local-hit R] [--json]
//   With a dir: triage discovered modules → easy/hard counts → simulate.
//   Without: pass --easy/--hard manually. Compares all-api vs hybrid vs bridge,
//   grounded in measured per-module costs from the ledger.

function flag(args: string[], n: string): string | undefined {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  const hit = Number(flag(args, '--local-hit') ?? '0.5');

  let easy = Number(flag(args, '--easy') ?? '0');
  let hard = Number(flag(args, '--hard') ?? '0');
  if (dir) {
    const adapter = await selectAdapterOrThrow(dir);
    const kind = (flag(args, '--kind') ?? 'unit') as 'unit' | 'e2e';
    const targets = await adapter.discover(dir, kind);
    let e = 0, h = 0;
    for (const t of targets) {
      const src = await readFile(join(dir, t.sourcePath), 'utf8').catch(() => '');
      isEasyTarget(t, src).easy ? e++ : h++;
    }
    easy = e; hard = h;
    console.error(`[simcost] triaged ${dir}: ${easy} easy + ${hard} hard (of ${targets.length})`);
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(savings(simulateCost({ easy, hard }, hit)), null, 2));
    return;
  }
  console.log(formatReport({ easy, hard }, hit));
}

main().catch((e) => { console.error('[simcost] error:', e.message); process.exit(1); });
