import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Single source of truth for the probevane command surface. Drives BOTH the
// generated skill (build.ts) and the drift/bijection gate (skill --check +
// self-tests). Add a command here when you add it to bin/probevane, or the gate
// fails — that's what keeps the skill auto-in-sync.

export interface Command {
  name: string;
  summary: string;
  usage: string;
  example: string;
}

export const COMMANDS: Command[] = [
  { name: 'init', summary: 'Detect the stack and install test deps + config.', usage: 'probevane init <dir>', example: 'probevane init ./my-app' },
  { name: 'generate', summary: 'Probe-grounded gated loop writes unit/e2e tests (mock maker, hermetic, audited).', usage: 'probevane generate <dir> [--kind unit|e2e] [--model auto|haiku|sonnet|opus|local:<id>] [--mock] [--mutation] [--flake-guard] [--target-gaps] [--passk N] [--budget N] [--only <substr>] [--spec]', example: 'probevane generate ./my-app --kind unit --mock' },
  { name: 'refactor', summary: 'Characterization-first refactor: change source only, every test stays green (behavior_lock).', usage: 'probevane refactor <dir> --task "<what to refactor>" [--model …] [--budget N]', example: 'probevane refactor ./app --task "extract helpers into utils.ts"' },
  { name: 'feature', summary: 'TDD red-first: write a failing test, implement, go green; existing tests protected.', usage: 'probevane feature <dir> --task "<feature>" [--model …]', example: 'probevane feature ./app --task "add a discount field to cartTotal"' },
  { name: 'repair', summary: 'After source changes, update the affected (stale) tests so the whole suite is green.', usage: 'probevane repair <dir> [--since <ref>] [--model …]', example: 'probevane repair ./app --since HEAD~1' },
  { name: 'fix', summary: 'Apply described issues/findings to the code, keeping the suite green + audit-clean.', usage: 'probevane fix <dir> --task "<issues>" [--model …]', example: 'probevane fix ./app --task "handle the null case in parse()"' },
  { name: 'review', summary: 'Read-only quality grade (0–100) of a suite: green, coverage, audit, flake.', usage: 'probevane review <dir> [--flake N]', example: 'probevane review ./app' },
  { name: 'bench', summary: 'Measure a suite: coverage, audit, and mutation score (does it catch bugs?).', usage: 'probevane bench <dir> [--mutants N]', example: 'probevane bench ./app --mutants 6' },
  { name: 'ci', summary: 'PR helper: report changed-untested files + coverage; --generate adds tests; --review-fix reviews the diff (gated) and auto-fixes.', usage: 'probevane ci <dir> [--base <ref>] [--generate] [--review-fix] [--strict]', example: 'probevane ci . --base origin/main --review-fix' },
  { name: 'mock', summary: 'Synthesize the mock boundary (MSW handlers, fixtures, contracts) from the module graph.', usage: 'probevane mock <dir>', example: 'probevane mock ./app' },
  { name: 'graph', summary: 'Render the module dependency graph (ASCII tree + Mermaid).', usage: 'probevane graph <dir> [--mermaid <file>]', example: 'probevane graph ./app --mermaid graph.md' },
  { name: 'spec', summary: 'Generate a project SPEC.md (graph, modules, API surface, coverage); --narrate adds LLM descriptions; --wiki publishes.', usage: 'probevane spec <dir> [--narrate] [--out <file>] [--wiki]', example: 'probevane spec ./app --narrate' },
  { name: 'run', summary: 'Execute the test suite via the detected adapter.', usage: 'probevane run <dir> [--scope unit|e2e|all]', example: 'probevane run ./app --scope unit' },
  { name: 'coverage', summary: 'Report coverage via the adapter.', usage: 'probevane coverage <dir>', example: 'probevane coverage ./app' },
  { name: 'audit', summary: 'Static quality gate over the spec files (exit 1 on errors).', usage: 'probevane audit <dir>', example: 'probevane audit ./app' },
  { name: 'status', summary: 'Quick dashboard: adapter, suite result, coverage.', usage: 'probevane status <dir>', example: 'probevane status ./app' },
  { name: 'learn', summary: 'Save a spec to the cross-project learning library.', usage: 'probevane learn <dir> --file <spec> --category <c> [--kind] [--bad]', example: 'probevane learn ./app --file src/x.test.ts --category crud' },
  { name: 'eval', summary: "Run probevane's fixture eval (self-test of the harness); --live regenerates.", usage: 'probevane eval [--live] [--flake N]', example: 'probevane eval' },
  { name: 'skill', summary: 'Generate/check the probevane control skill (this doc). --check fails on drift.', usage: 'probevane skill [--check]', example: 'probevane skill --check' },
];

/** Commands accepted by bin/probevane that intentionally aren't user-facing skill entries. */
export const UNDOCUMENTED = new Set(['plan', 'watch', 'version', '-v', '--version', 'help', '-h', '--help']);

/** Parse the command names the bin dispatcher accepts (the `a|b|c)` case line). */
export async function binCommands(): Promise<string[]> {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'probevane');
  const src = await readFile(bin, 'utf8');
  const m = src.match(/^\s*(init\|[a-z|]+)\)/m);
  return m ? m[1].split('|') : [];
}
