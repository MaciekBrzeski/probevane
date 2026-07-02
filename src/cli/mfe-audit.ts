import { resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { scanMfe } from '../mfe/scan.js';
import { formatMfe, versionAlign, type MfeViolation, type RepoShared, type MfeAudit } from '../mfe/standards.js';
import { parseRepoList } from '../factory/report.js';
import { flag } from './args.js';

// probevane mfe-audit <dir | repos.txt> [--repos <file>] [--json] [--strict]
//                     [--design-system <pkg>]
//
// Module Federation standards gate (MFE Phase A): boundaries (no deep cross-remote
// imports), shared singletons, runtime resilience (Suspense + error boundary), and
// typed contracts — per repo. With multiple repos it also checks cross-repo shared
// version alignment. Pure analysis ($0, no LLM). --strict exits 1 on errors — the
// fitness function the refactor loop will later enforce.

async function isFile(p: string): Promise<boolean> {
  return (await stat(p).then((s) => s.isFile()).catch(() => false));
}

async function resolveRepos(args: string[]): Promise<string[]> {
  const listFlag = flag(args, '--repos');
  const positional = args.find((a) => !a.startsWith('--'));
  const listFile = listFlag ?? (positional && (await isFile(resolve(positional))) ? resolve(positional) : undefined);
  if (listFile) return parseRepoList(await readFile(listFile, 'utf8'));
  return positional ? [positional] : ['.'];
}

/** Human-readable per-repo report + the cross-repo alignment section. */
function printHuman(rows: { repo: string; audit: MfeAudit }[], align: MfeViolation[]): void {
  for (const { repo, audit: a } of rows) {
    if (a.violations.length)
      console.log(`\n# ${repo} (${a.name || '?'}${a.isHost ? ', host' : ''})\n${formatMfe(a.violations)}`);
    console.log(`[mfe] ${repo}: ${a.errors} error(s), ${a.warns} warn(s), grade ${a.grade}/100`);
  }
  if (align.length) console.log(`\n# cross-repo\n${formatMfe(align)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const designSystem = flag(args, '--design-system');
  const repos = await resolveRepos(args);

  const scans = (await Promise.all(repos.map((r) => scanMfe(resolve(r), designSystem)))).map(
    (s, i) => ({ repo: repos[i], s }),
  );
  const found = scans.filter((x) => x.s);
  if (!found.length) {
    console.log('[probevane] mfe-audit: no Module Federation config found');
    return;
  }

  // Cross-repo: shared version alignment (only meaningful with >1 MFE).
  const shared: RepoShared[] = found.map((x) => ({
    name: x.s!.audit.name || x.repo,
    shared: x.s!.input.config.shared,
    pkg: x.s!.input.pkg,
  }));
  const align: MfeViolation[] = repos.length > 1 ? versionAlign(shared) : [];

  if (json) {
    console.log(JSON.stringify(
      { repos: found.map((x) => ({ repo: x.repo, audit: x.s!.audit })), versionAlign: align },
      null,
      2,
    ));
  } else {
    printHuman(found.map((x) => ({ repo: x.repo, audit: x.s!.audit })), align);
  }

  const errors = found.reduce((n, x) => n + x.s!.audit.errors, 0) + align.filter((v) => v.severity === 'error').length;
  if (args.includes('--strict') && errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
