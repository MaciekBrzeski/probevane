import { resolve, join } from 'node:path';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { statePath } from '../util/state.js';
import { loadConfig } from '../config.js';
import { runFactory } from '../factory/run.js';
import { parseRepoList, acceptedRepos, type FactoryReport, type FactoryRepoResult } from '../factory/report.js';
import type { TestKind } from '../adapters/adapter.js';

// probevane factory <repos.txt | dir...> [--concurrency N] [--kind unit|e2e]
//                  [--report <path>] [--state-root <dir>] [--no-checkpoint]
//                  [...any generate flags, forwarded per-repo]
//
// Runs the gated generate loop over many repos concurrently, each with isolated
// state, reverting any repo whose run errors, then writes a cost/coverage/quality
// rollup. Flags it doesn't recognize are forwarded verbatim to `generate`.

// Factory-only flags and their arity (1 = takes a value). Everything else is
// passed through to the per-repo `generate` invocation.
const OWN: Record<string, 0 | 1> = {
  '--concurrency': 1,
  '--kind': 1,
  '--report': 1,
  '--state-root': 1,
  '--repos': 1,
  '--no-checkpoint': 0,
  '--resume': 0,
  '--no-retry': 0,
};

async function main() {
  const argv = process.argv.slice(2);
  const positionals: string[] = [];
  const own: Record<string, string | boolean> = {};
  const passThrough: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const arity = OWN[a];
      if (arity === 1) {
        own[a] = argv[++i];
      } else if (arity === 0) {
        own[a] = true;
      } else {
        // Unknown flag → forward to generate (with its value if it has one).
        passThrough.push(a);
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) passThrough.push(argv[++i]);
      }
    } else {
      positionals.push(a);
    }
  }

  // Resolve the repo list: --repos <file>, a single positional file, or positional dirs.
  let repos: string[] = [];
  const listFile = (own['--repos'] as string) ?? (await onlyFile(positionals));
  if (listFile) {
    repos = parseRepoList(await readFile(listFile, 'utf8'));
  } else {
    repos = positionals;
  }
  if (!repos.length) {
    console.error(
      'usage: probevane factory <repos.txt | dir...> [--concurrency N] [--kind unit|e2e] [--report <path>] [...generate flags]',
    );
    process.exit(2);
  }

  const kind = ((own['--kind'] as string) ?? 'unit') as TestKind;
  const concurrency = parseInt((own['--concurrency'] as string) ?? '4', 10);
  const stateRoot = resolve(
    (own['--state-root'] as string) ?? statePath('factory', `run-${Date.now().toString(36)}`),
  );
  const checkpoint = own['--no-checkpoint'] !== true;
  const retry = own['--no-retry'] !== true;
  const reportPath = resolve((own['--report'] as string) ?? join(stateRoot, 'report.json'));
  const binPath = join(process.env.PROBEVANE_ROOT ?? resolve('.'), 'bin', 'probevane');

  // --resume: load the prior report (at reportPath) and skip its accepted repos.
  let prior: FactoryReport | null = null;
  let skip = new Set<string>();
  if (own['--resume'] === true) {
    prior = await readFile(reportPath, 'utf8').then((s) => JSON.parse(s) as FactoryReport).catch(() => null);
    skip = acceptedRepos(prior);
    if (skip.size) console.error(`[factory] resume: skipping ${skip.size} already-accepted repo(s)`);
  }

  // Surface any per-repo generate config defaults the user wouldn't otherwise see
  // (factory forwards flags but each child also reads its own probevane.config).
  await loadConfig(resolve(repos[0])).catch(() => undefined);

  await mkdir(stateRoot, { recursive: true });
  console.error(
    `[factory] ${repos.length} repo(s), ${concurrency}-way, kind=${kind}, state=${stateRoot}` +
      (passThrough.length ? `, forwarding: ${passThrough.join(' ')}` : ''),
  );

  const report = await runFactory({
    repos,
    kind,
    concurrency,
    stateRoot,
    passThrough,
    binPath,
    checkpoint,
    retry,
    skip,
    prior,
    log: (l) => console.error(l),
  });

  await writeFile(reportPath, JSON.stringify(report, null, 2));

  // Rollup.
  console.log('');
  for (const r of report.results) console.log('  ' + rowLine(r));
  const modes = Object.entries(report.byStopReason)
    .filter(([k]) => k !== 'accepted')
    .map(([k, n]) => `${k}:${n}`)
    .join(' ');
  console.log(
    `\n[factory] ${report.accepted}/${report.repos} accepted (${(report.acceptRate * 100).toFixed(0)}%), ` +
      `${report.totalTests} tests, $${report.totalCost.toFixed(4)}` +
      (modes ? ` · failures: ${modes}` : '') +
      ` → ${reportPath}`,
  );

  if (report.accepted < report.repos) process.exit(1);
}

function rowLine(r: FactoryRepoResult): string {
  const name = r.repo.replace(/\/+$/, '').split('/').pop() || r.repo;
  if (r.accepted) {
    const cov = r.coverage != null ? `cov ${r.coverage}%` : 'cov n/a';
    return `${name}  ✓ ${r.tests} tests  ${cov}  $${r.cost.toFixed(4)}${r.cached ? '  (cached)' : ''}`;
  }
  const tail = r.reverted ? 'reverted' : r.error ? r.error : r.stopReason;
  return `${name}  ✗ ${r.stopReason}${tail !== r.stopReason ? ` (${tail})` : ''}`;
}

/** If `positionals` is exactly one entry and it's a regular file, return it. */
async function onlyFile(positionals: string[]): Promise<string | undefined> {
  if (positionals.length !== 1) return undefined;
  const p = resolve(positionals[0]);
  const s = await stat(p).catch(() => null);
  return s?.isFile() ? p : undefined;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
