import type { Rune, RuneDecision } from '../rune.js';
import { tail } from '../../util/text.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { RunScope } from '../../adapters/adapter.js';
import { sh } from '../../util/exec.js';

// validation_gate — ported from runestone validation_gate.rs. The run can NOT
// finish while: typecheck fails, OR the test suite is red, OR no test was
// actually added, OR the suite is all-skipped (the qaforge `all-skipped`
// anti-pattern promoted to a hard gate). Block => loop continues with feedback.
// Scope-aware: a unit run validates the unit suite; an e2e run the e2e suite.

// Captured once before any edits: the project's baseline type-error COUNT.
// We don't demand a clean project (big real apps often aren't) — but we DO
// block if our edits INCREASE the error count, i.e. the tests we wrote added
// type errors. Count-based, not all-or-nothing, so a dirty baseline can't mask
// a tsc-dirty new test (the bug a loop-written gates.test.ts slipped through).
interface ValidationState {
  baselineErrors: number;
  baselineTypecheckOk: boolean;
  zeroCollected: number; // times the runner collected 0 tests (repeat → fatalDiagnosis)
  envErrored: number; // times the suite failed to EXECUTE on an env/infra signal
}

// Signatures of an ENVIRONMENT failure (the runner couldn't execute) vs a red test:
// missing binary / dep / module, or blocked network. Only consulted when 0 tests ran.
const INFRA_ERROR =
  /command not found|: not found|\bENOENT\b|Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|\bECONNREFUSED\b|\bEADDRINUSE\b|No such file or directory|is not recognized as/i;

/** If the suite output shows an environment/infra failure signature, return it. */
function infraError(raw: string): string | null {
  return raw.match(INFRA_ERROR)?.[0] ?? null;
}

const VALIDATION_SYSTEM_PROMPT =
  'FINISH RULE: You may only stop once your changes add NO new type errors AND the new tests run green (no failures, not all-skipped). If a gate reports failure, fix the FIRST reported failure (shown under "FIX THIS FIRST"), re-run, then the next — one at a time. Do not rewrite the whole file each turn.';

/** Capture the pre-edit type-error baseline; a dirty project is noted, not fixed. */
async function validationPrepare(ctx: RunCtx, state: ValidationState): Promise<string | undefined> {
  const tc = await sh(ctx.adapter.commands(ctx.workdir).typecheck, ctx.workdir);
  state.baselineTypecheckOk = tc.ok;
  state.baselineErrors = countTsErrors(tc.stdout + tc.stderr);
  return state.baselineTypecheckOk
    ? undefined
    : `NOTE: the project has ${state.baselineErrors} pre-existing type error(s) on its own; that's not yours to fix — but your tests must not ADD any.`;
}

/** Block only when the error COUNT rose above the baseline — i.e. OUR edits added type errors. */
async function validationTypecheckCheck(ctx: RunCtx, state: ValidationState): Promise<RuneDecision | undefined> {
  const cmds = ctx.adapter.commands(ctx.workdir);
  const tc = await sh(cmds.typecheck, ctx.workdir);
  const errs = countTsErrors(tc.stdout + tc.stderr);
  if (!tc.ok && errs > state.baselineErrors) {
    return block(
      `validation_gate: typecheck added ${errs - state.baselineErrors} new type error(s)`,
      `Your changes introduced type errors (\`${cmds.typecheck}\`, ${state.baselineErrors}→${errs}):\n${tail(tc.stdout + tc.stderr)}`,
    );
  }
  return undefined;
}

/** Run the suite (our specs only, unless full) and block with the first failure front-and-center. */
async function validationRunCheck(
  ctx: RunCtx, scope: RunScope, full: boolean, state: ValidationState,
): Promise<RuneDecision> {
  // Scope to the specs we wrote — a real app's pre-existing suite may be
  // red under our config and is not ours to fix (no_regression forbids
  // touching it). We validate the tests we added. (full=true → whole suite,
  // used by the repair path which must leave everything green.)
  const ours = full ? [] : newSpecs(ctx);
  const run = await ctx.adapter.run(ctx.workdir, scope, ours.length ? ours : undefined);
  ctx.validatedSinceEdit = true;
  // Cognitive checks: when NOTHING ran (0 tests), a red-suite message is a
  // misdiagnosis — the model can't fix it by editing code. Distinguish an
  // environment failure (runner couldn't execute) from a discovery/scope miss,
  // name each accurately, and on repeat set an honest terminal diagnosis so the
  // engine stops (fatalCheck) instead of thrashing to a generic 'difficulty'.
  if (run.passed + run.failed + run.skipped === 0) {
    const infra = infraError(run.raw);
    if (infra) return envErrored(ctx, infra, state);
    if (ours.length) return zeroCollected(ctx, ours, state);
  }
  if (!run.green) {
    // Lead with the FIRST failing test + its assertion — weak/local models fix
    // a precise signal far better than a 2500-char raw dump (fourier-nca lesson:
    // minimal targeted signal; repair is the lever). Full tail stays, secondary.
    const first = firstFailure(run.raw);
    const focus = first ? `FIX THIS FIRST:\n${first}\n\n` : '';
    return block(
      `validation_gate: ${scope} tests not green`,
      `The ${scope} tests are not green (passed=${run.passed} failed=${run.failed} skipped=${run.skipped}).\n${focus}Full output:\n${tail(run.raw)}`,
    );
  }
  return ALLOW;
}

/** The "0 tests collected" diagnosis — a discovery/config problem, not a red suite.
 *  First occurrence: a one-time UI note + an accurate Block (give the model a chance
 *  to fix scope/config). On REPEAT: also set ctx.fatalDiagnosis so the engine ends
 *  the run honestly (misconfigured) instead of rewriting passing test code to death. */
function zeroCollected(ctx: RunCtx, ours: string[], state: ValidationState): RuneDecision {
  state.zeroCollected++;
  if (state.zeroCollected === 1) {
    ctx.notes.push(`⚠ validation: 0 tests collected from the new spec(s) — the runner isn't discovering them (scope/config), not a code failure`);
  } else {
    ctx.fatalDiagnosis =
      `0 tests collected from the new spec(s) ${ours.join(', ')} across ${state.zeroCollected} attempts — ` +
      'the runner is not discovering them (a scope/config mismatch, e.g. a monorepo where the test command ' +
      'runs at the repo root instead of the sub-package). A harness/config problem, not something the model ' +
      'can fix by editing test code.';
  }
  return block(
    'validation_gate: 0 tests collected (runner did not discover the new spec)',
    `The test runner ran but collected 0 tests from your new spec(s): ${ours.join(', ')}.\n` +
      'This is a DISCOVERY problem, not a failing test: either the spec has no runnable test (empty/placeholder), ' +
      'or — more often — the runner is scoped wrong for this path (a monorepo where the command runs at the repo ' +
      'root instead of the sub-package, or an include/testMatch that misses this file). Confirm the project\'s own ' +
      'test command actually picks up this spec; if the harness runs the runner at the wrong root, editing test ' +
      'code cannot make this pass.',
  );
}

/** An ENVIRONMENT/infra failure (the runner couldn't execute — missing binary/dep,
 *  blocked network), NOT a red test. Accurate note + Block; fatal on repeat. */
function envErrored(ctx: RunCtx, sig: string, state: ValidationState): RuneDecision {
  state.envErrored++;
  if (state.envErrored === 1) {
    ctx.notes.push(`⚠ validation: suite failed to execute (matched "${sig}") — an environment/dependency error, not a code failure`);
  } else {
    ctx.fatalDiagnosis =
      `The test runner keeps failing to EXECUTE (matched "${sig}") across ${state.envErrored} attempts — ` +
      'an environment/dependency error (a missing binary, an uninstalled dependency, or blocked network). ' +
      'The toolchain/deps need to be present; the model cannot fix this by editing code.';
  }
  return block(
    'validation_gate: test runner failed to execute (environment error)',
    `The test runner did not run any tests and its output shows an environment failure (matched "${sig}").\n` +
      'This is an ENVIRONMENT/dependency problem (missing binary, uninstalled dependency, or blocked network), ' +
      'not a failing test — editing test code will not fix it. If a dependency is genuinely missing, it must be ' +
      'installed; the harness/toolchain, not the test code, is at fault.',
  );
}

/** Gate body: something written → typecheck delta → suite green, in fail-fast order. */
async function validationShouldStop(
  ctx: RunCtx,
  scope: RunScope,
  full: boolean,
  state: ValidationState,
): Promise<RuneDecision> {
  if (ctx.editedFiles.size === 0) {
    return block(
      'validation_gate: no test file was written',
      'You stopped without writing any test. Plan, then write at least one real test, then finish.',
    );
  }
  const tcDecision = await validationTypecheckCheck(ctx, state);
  if (tcDecision) return tcDecision;
  return validationRunCheck(ctx, scope, full, state);
}

/** Build the validation rune for a scope; full=true validates the WHOLE suite (repair path). */
export function validationGate(scope: RunScope = 'unit', full = false): Rune {
  const state: ValidationState = { baselineErrors: 0, baselineTypecheckOk: true, zeroCollected: 0, envErrored: 0 };
  return {
    name: 'validation_gate',
    systemPromptAddition: () => VALIDATION_SYSTEM_PROMPT,
    prepare: (ctx) => validationPrepare(ctx, state),
    shouldStop: (ctx) => validationShouldStop(ctx, scope, full, state),
  };
}

// cross/×/✕/✗ marks via \u escapes (avoid glyph copy ambiguity).
const FAIL_MARKER = /(^|\n)\s*(?:[×✕✗]|FAIL(?:ED)?\b)\s|(AssertionError|Error:|expected .* (?:to|but)|^E\s{2,}|assert\b)/i;
// next test-result line: a check/cross mark or PASS/FAIL (marks via \u to avoid glyph drift).
const NEXT_RESULT = /^\s*(?:[✓✔✗✕×]|PASS(?:ED)?|FAIL(?:ED)?)/;
// First failing test + a few lines of its assertion, across runners. Weak models
// repair a single precise failure far better than the whole dump.
export function firstFailure(raw: string, lines = 12): string | undefined {
  if (!raw) return undefined;
  const ls = raw.split('\n');
  const i = ls.findIndex((l) => FAIL_MARKER.test(l));
  if (i < 0) return undefined;
  // Marker line + its (indented) assertion body, stopping at the NEXT test-result
  // line so we don't bleed into subsequent passing tests.
  const out = [ls[i]];
  for (let k = i + 1; k < ls.length && out.length < lines; k++) {
    if (NEXT_RESULT.test(ls[k])) break;
    if (ls[k].trim()) out.push(ls[k]);
  }
  return out.join('\n').slice(0, 800);
}

/** Count `error TSxxxx` diagnostics in a tsc run (dedup-free, one per occurrence). */
export function countTsErrors(output: string): number {
  return (output.match(/error TS\d+/g) ?? []).length;
}

const SPEC_RE = /(\.(test|spec)\.[tj]sx?$)|((^|\/)test_\w+\.py$)|(_test\.py$)/;
/** The spec files THIS run wrote — the scope most gates judge. */
export function newSpecs(ctx: RunCtx): string[] {
  return [...ctx.editedFiles].filter((f) => SPEC_RE.test(f));
}
