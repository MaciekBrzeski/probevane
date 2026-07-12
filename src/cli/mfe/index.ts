import { resolve, join } from 'node:path';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { runMfe } from '../../mfe/driver.js';
import { parseRepoList } from '../../factory/report.js';
import { formatMfe } from '../../mfe/standards.js';
import { flag } from '../args.js';

// probevane mfe <repos.txt | dir...> [--contract] [--generate] [--fix]
//               [--model …] [--concurrency N] [--report <path>]
//
// Drive the micro-frontend (Module Federation) pipeline over a polyrepo fleet:
// per repo audit → (contract tests) → (generate tests) → (fix standards), then
// cross-repo shared-version alignment. Default (no LLM flags) = a $0 fleet
// standards report; --contract adds deterministic contract tests; --generate /
// --fix run the LLM loop. Writes a combined report.json.

async function resolveRepos(args: string[]): Promise<string[]> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  // Drop a value that belongs to a value-taking flag (--model X --concurrency N --report P).
  const taken = new Set<string>();
  for (const f of ['--model', '--concurrency', '--report']) {
    const v = flag(args, f);
    if (v) taken.add(v);
  }
  const pos = positionals.filter((p) => !taken.has(p));
  if (pos.length === 1 && (await stat(resolve(pos[0])).then((s) => s.isFile()).catch(() => false)))
    return parseRepoList(await readFile(resolve(pos[0]), 'utf8'));
  return pos.length ? pos : ['.'];
}

async function main() {
  const args = process.argv.slice(2);
  const repos = await resolveRepos(args);
  const report = await runMfe({
    repos,
    binPath: join(process.env.PROBEVANE_ROOT ?? resolve('.'), 'bin', 'probevane'),
    concurrency: parseInt(flag(args, '--concurrency') ?? '4', 10),
    contract: args.includes('--contract'),
    generate: args.includes('--generate'),
    fix: args.includes('--fix'),
    model: flag(args, '--model'),
    log: (l) => console.error(l),
  });

  const reportPath = resolve(flag(args, '--report') ?? join(process.cwd(), 'mfe-report.json'));
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  for (const r of report.results) {
    if (!r.isMfe) {
      console.log(`  ${r.repo}  — not an MFE`);
      continue;
    }
    const delta = r.errorsAfter !== undefined ? ` → ${r.errorsAfter} after fix` : '';
    console.log(`  ${r.name || r.repo}  grade ${r.grade}/100  ${r.errorsBefore} err${delta}  [${r.stages.join(',')}]${r.stageErrors ? ' ✗ ' + r.stageErrors.join('; ') : ''}`);
  }
  if (report.versionAlign.length) console.log(`\ncross-repo:\n${formatMfe(report.versionAlign)}`);
  console.log(
    `\n[mfe] ${report.mfeRepos}/${report.repos} MFE repo(s), avg grade ${report.avgGrade}/100, ` +
      `${report.totalErrors} error(s)${report.improved ? `, ${report.improved} improved` : ''} → ${reportPath}`,
  );

  if (report.totalErrors > 0 && args.includes('--strict')) process.exit(1);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
