import { join, relative, resolve } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { parseFederation, isFederationConfig, type FederationConfig } from './federation.js';
import { auditRepo, type MfeAudit, type MfeRepoInput, type RepoShared } from './standards.js';

// I/O wrapper for the MFE audit: find a repo's Module Federation config, read its
// package.json + source tree, and run the pure auditRepo. Shared by the
// mfe-audit CLI (and later the mfe driver). Excluded from coverage like the other
// fs glue — the pure analysis lives in federation.ts / standards.ts.
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.probevane']);
const SRC = /\.(tsx|ts|jsx|js)$/;
const TEST = /\.(test|spec|d)\.[tj]sx?$/;
// Config files that may carry a Module Federation block.
const CONFIG = /^(webpack|rspack|vite|rollup)\.config\.[cm]?[jt]s$|^module-federation\.config\.[cm]?[jt]s$/;

/** Depth-capped recursive file finder, skipping generated dirs — read errors count
 *  as empty so a missing/unreadable dir never aborts a scan. */
async function walk(dir: string, match: RegExp, depth = 6): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (depth > 0 && !SKIP.has(e.name)) out.push(...(await walk(join(dir, e.name), match, depth - 1)));
    } else if (match.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

/** Find + parse the repo's federation config (merges candidate config files). */
export async function readFederation(dir: string): Promise<FederationConfig | null> {
  const candidates = await walk(dir, CONFIG, 3);
  let combined = '';
  for (const f of candidates) {
    const text = await readFile(f, 'utf8').catch(() => '');
    if (isFederationConfig(text)) combined += '\n' + text;
  }
  return combined ? parseFederation(combined) : null;
}

/** Build the federation shared[] list across a repo fleet: read each repo's config
 *  + package.json, skipping non-MFE repos. Shared by the factory + mfe driver. */
export async function collectRepoShared(repos: string[]): Promise<RepoShared[]> {
  const feds: RepoShared[] = [];
  for (const repo of repos) {
    const cfg = await readFederation(resolve(repo)).catch(() => null);
    if (cfg) {
      const pkg = await readFile(join(resolve(repo), 'package.json'), 'utf8').then(JSON.parse).catch(() => ({}));
      feds.push({ name: cfg.name || repo, shared: cfg.shared, pkg });
    }
  }
  return feds;
}

/** One repo's scan result: dir + the pure-audit input (config/pkg/sources) + the
 *  audit itself. Filled by scanMfe, consumed by the mfe CLI and driver. */
export interface MfeScan {
  dir: string;
  input: MfeRepoInput;
  audit: MfeAudit;
}

/** Scan one repo; null when it has no Module Federation config (not an MFE). */
export async function scanMfe(dir: string, designSystem?: string): Promise<MfeScan | null> {
  const config = await readFederation(dir);
  if (!config) return null;
  const pkg = await readFile(join(dir, 'package.json'), 'utf8')
    .then((s) => JSON.parse(s))
    .catch(() => ({}));
  const srcRoot = (await stat(join(dir, 'src')).then((s) => s.isDirectory()).catch(() => false))
    ? join(dir, 'src')
    : dir;
  const files = (await walk(srcRoot, SRC)).filter((f) => !TEST.test(f));
  const sources = await Promise.all(
    files.map(async (f) => ({ file: relative(dir, f), source: await readFile(f, 'utf8').catch(() => '') })),
  );
  const input: MfeRepoInput = { config, pkg, sources, designSystem };
  return { dir, input, audit: auditRepo(input) };
}
