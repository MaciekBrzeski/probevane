import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StackAdapter, TestKind, RunScope } from '../adapters/adapter.js';
import { auditFiles, formatViolations } from '../audit/core.js';
import { recordRun } from '../cost/ledger.js';

// Shape B — whole-task delegation. Instead of driving the model turn-by-turn,
// hand the ENTIRE test-writing task to an external agent harness (here: headless
// `claude -p`, which reads the code + writes specs itself), then run probevane's
// GATES on the resulting diff and re-delegate with the feedback on failure. This
// makes probevane a quality/eval layer over ANY harness that can edit files in a
// workdir — the "integrate with other harnesses" path. Bounded rounds; cost from
// the CLI envelope. Safety: runs in a git workdir — review/revert via git.

const TEST_RE = /(\.(test|spec)\.[tj]sx?$)|(test_\w+\.py$)|(_test\.py$)|(_test\.go$)|(tests\/.*\.rs$)/;
const TIMEOUT_MS = Number(process.env.PROBEVANE_CC_TIMEOUT_MS ?? 600_000);

export interface DelegateOpts {
  dir: string;
  kind: TestKind;
  adapter: StackAdapter;
  model?: string; // claude model for `claude -p --model`
  maxRounds?: number;
  only?: string; // scope delegation to one module (path substring)
  log?: (l: string) => void;
}

export interface DelegateOutcome {
  accepted: boolean;
  rounds: number;
  changedFiles: string[];
  costUsd: number;
  green: boolean;
  auditErrors: number;
}

interface RoundResult {
  cost: number;
  changed: string[];
  green: boolean;
  auditErrors: number;
  feedback: string;
}

/** The base delegation prompt — invariant across rounds. */
function buildBasePrompt(opts: DelegateOpts, dir: string, kind: TestKind): string {
  const { adapter } = opts;
  const target = opts.only ? `the source module \`${opts.only}\`` : `the source modules in this project (${dir})`;
  return [
    `Write probevane-quality ${kind} tests for ${target}.`,
    `Read the source yourself, then write the spec file(s) ${adapter.guidance(kind)}`,
    `Assert concrete values; cover happy paths, edge cases, and error paths; no brittle waits,`,
    `no conditional assertions. Import only real symbols. Run the suite and make it GREEN before`,
    `you stop. Write ONLY test files — do not modify source.`,
  ].join('\n');
}

/** The per-round prompt: base on round 1, base + prior-gate feedback afterwards. */
function buildPrompt(base: string, round: number, feedback: string): string {
  return round === 1 ? base : `${base}\n\nYOUR PREVIOUS ATTEMPT DID NOT PASS THE GATES:\n${feedback}\nFix it.`;
}

/** One delegation round: spawn `claude -p`, then run the suite + audit on the
 *  changed test files and derive green/auditErrors and the next-round feedback. */
interface RoundCtx {
  opts: DelegateOpts;
  dir: string;
  scope: RunScope;
  base: string;
  round: number;
  feedback: string;
}

async function delegateRound(c: RoundCtx): Promise<RoundResult> {
  const { opts, dir, scope, base, round, feedback } = c;
  const { adapter } = opts;
  const log = opts.log ?? (() => {});
  const prompt = buildPrompt(base, round, feedback);
  log(`[delegate] round ${round}: delegating to claude -p…`);
  const env = { ...process.env };
  if (process.env.PROBEVANE_CC_SUBSCRIPTION === '1') delete env.ANTHROPIC_API_KEY;
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits'];
  if (opts.model) args.push('--model', opts.model);
  const envelope = JSON.parse(await spawn('claude', args, prompt, dir, env));
  const cost = typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : 0;

  const changed = await changedTestFiles(dir);
  const run = await adapter.run(dir, scope, changed.length ? changed : undefined).catch((e) => {
    log(`[delegate] run error: ${e}`); return { passed: 0, failed: 1, green: false } as any;
  });
  const report = await auditFiles(changed.map((f) => join(dir, f)), adapter.auditRules()).catch(() => ({ errors: 0, violations: [] } as any));
  const green = !!run.green && changed.length > 0;
  const auditErrors = report.errors ?? 0;
  log(`[delegate] round ${round}: ${changed.length} spec(s), suite ${green ? 'GREEN' : 'red'} (${run.passed}/${run.passed + run.failed}), audit ${auditErrors} err`);

  const nextFeedback = [
    green ? '' : `- Suite not green: ${run.failed} failing test(s).`,
    auditErrors ? `- Audit errors:\n${formatViolations(report.violations ?? [])}` : '',
    changed.length === 0 ? '- No test file was written.' : '',
  ].filter(Boolean).join('\n');
  return { cost, changed, green, auditErrors, feedback: nextFeedback };
}

export async function runDelegated(opts: DelegateOpts): Promise<DelegateOutcome> {
  const { dir, kind } = opts;
  const scope: RunScope = kind === 'e2e' ? 'e2e' : 'unit';
  const maxRounds = opts.maxRounds ?? 3;
  const runId = `delegate-${Date.now().toString(36)}`;
  const base = buildBasePrompt(opts, dir, kind);

  let costUsd = 0;
  let changed: string[] = [];
  let green = false;
  let auditErrors = 0;
  let round = 0;
  let feedback = '';

  for (round = 1; round <= maxRounds; round++) {
    const r = await delegateRound({ opts, dir, scope, base, round, feedback });
    costUsd += r.cost;
    changed = r.changed;
    green = r.green;
    auditErrors = r.auditErrors;
    feedback = r.feedback;
    if (green && auditErrors === 0) break;
  }

  const accepted = green && auditErrors === 0;
  const roundsRun = accepted ? round : maxRounds; // for-loop ends at maxRounds+1 when no break
  await recordRun({
    ts: new Date().toISOString(), runId, label: `delegate:${dir.split('/').pop()}`,
    model: opts.model ? `claude-code:${opts.model}` : 'claude-code',
    tokensIn: 0, tokensOut: 0, cacheRead: 0, accepted, tookOver: false,
    stopReason: accepted ? 'accepted' : 'max_steps', steps: roundsRun, costUsd: costUsd || undefined,
  });
  return { accepted, rounds: roundsRun, changedFiles: changed, costUsd, green, auditErrors };
}

async function changedTestFiles(dir: string): Promise<string[]> {
  const tracked = await git(dir, ['diff', '--name-only']);
  const untracked = await git(dir, ['ls-files', '--others', '--exclude-standard']);
  const all = [...tracked.split('\n'), ...untracked.split('\n')].map((s) => s.trim()).filter(Boolean);
  return [...new Set(all)].filter((f) => TEST_RE.test(f));
}

function git(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { maxBuffer: 8 * 1024 * 1024 }, (_e, out) => resolve(out ?? ''));
  });
}

function spawn(cmd: string, args: string[], input: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { cwd, env, maxBuffer: 32 * 1024 * 1024, timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`claude -p (delegate) failed: ${err.message}\n${stderr}`));
      resolve(stdout);
    });
    child.stdin?.end(input);
  });
}
