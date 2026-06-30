import { spawn } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { scanMfe, collectRepoShared } from './scan.js';
import { planContracts } from './contract-scan.js';
import { versionAlign, formatMfe } from './standards.js';
import { runPool } from '../util/concurrent.js';
import { aggregateMfe, type MfeDriverReport, type MfeDriverResult } from './report.js';

// The `mfe` driver (Phase D) — sequence the MFE pipeline over a polyrepo fleet:
// per repo audit → (contract) → (generate) → (fix), then cross-repo version-align.
// Deterministic stages (audit, contract, align) run $0 in-process; the LLM stages
// (generate, fix) are opt-in flags that spawn the child commands. Process/fs
// orchestration → excluded from coverage; the rollup (report.ts) is the tested part.

export interface MfeDriverOpts {
  repos: string[];
  binPath: string;
  concurrency: number;
  contract: boolean; // write contract tests (deterministic)
  generate: boolean; // spawn `generate` (LLM)
  fix: boolean; // spawn `refactor --mfe --quality` to fix violations (LLM)
  model?: string;
  log: (l: string) => void;
}

function spawnCmd(bin: string, args: string[], tag: string, log: (l: string) => void): Promise<number> {
  return new Promise((res) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const pipe = (buf: Buffer) => String(buf).split('\n').filter(Boolean).forEach((l) => log(`${tag} ${l}`));
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('close', (c) => res(c ?? 1));
    child.on('error', () => res(1));
  });
}

async function writeContracts(dir: string, log: (l: string) => void): Promise<boolean> {
  const plan = await planContracts(dir).catch(() => null);
  if (!plan || !plan.files.length) return false;
  for (const f of plan.files) {
    await mkdir(dirname(f.path), { recursive: true });
    await writeFile(f.path, f.content);
  }
  log(`[${basename(dir)}] contract: wrote ${plan.files.length} test(s)`);
  return true;
}

async function processRepo(repo: string, opts: MfeDriverOpts): Promise<MfeDriverResult> {
  const dir = resolve(repo);
  const tag = `[${basename(repo)}]`;
  const scan = await scanMfe(dir).catch(() => null);
  if (!scan) {
    opts.log(`${tag} not a Module Federation repo — skipping`);
    return { repo, isMfe: false, stages: [] };
  }
  const stages = ['audit'];
  const stageErrors: string[] = [];
  const errorsBefore = scan.audit.errors;
  opts.log(`${tag} audit: ${errorsBefore} error(s), grade ${scan.audit.grade}/100`);

  if (opts.contract && (await writeContracts(dir, opts.log))) stages.push('contract');

  const model = opts.model ? ['--model', opts.model] : [];
  if (opts.generate) {
    const code = await spawnCmd(opts.binPath, ['generate', dir, ...model], tag, opts.log);
    stages.push('generate');
    if (code !== 0) stageErrors.push(`generate: exit ${code}`);
  }

  let grade = scan.audit.grade;
  let errorsAfter: number | undefined;
  if (opts.fix) {
    const errs = scan.audit.violations.filter((v) => v.severity === 'error');
    const task = `Fix these Module Federation standards violations:\n${formatMfe(errs).slice(0, 1500)}`;
    const code = await spawnCmd(opts.binPath, ['refactor', dir, '--mfe', '--quality', ...model, '--task', task], tag, opts.log);
    stages.push('fix');
    if (code !== 0) stageErrors.push(`fix: exit ${code}`);
    const re = await scanMfe(dir).catch(() => null);
    if (re) {
      errorsAfter = re.audit.errors;
      grade = re.audit.grade;
    }
  }

  return {
    repo,
    isMfe: true,
    name: scan.audit.name,
    errorsBefore,
    errorsAfter,
    warns: scan.audit.warns,
    grade,
    stages,
    stageErrors: stageErrors.length ? stageErrors : undefined,
  };
}

export async function runMfe(opts: MfeDriverOpts): Promise<MfeDriverReport> {
  const results = await runPool(
    opts.repos,
    (r) => processRepo(r, opts).catch((e): MfeDriverResult => ({ repo: r, isMfe: false, stages: [], stageErrors: [String(e?.message ?? e)] })),
    opts.concurrency,
  );

  // Cross-repo shared-version alignment over the federation fleet.
  const feds = await collectRepoShared(opts.repos);
  const align = feds.length >= 2 ? versionAlign(feds) : [];
  return aggregateMfe(results, align, new Date().toISOString());
}
