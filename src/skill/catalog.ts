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
  { name: 'generate', summary: 'Probe-grounded gated loop writes unit/e2e tests (mock maker, hermetic, audited).', usage: 'probevane generate <dir> [--kind unit|e2e] [--model auto|haiku|sonnet|opus|local:<id>] [--mock] [--mutation] [--flake-guard] [--target-gaps] [--a11y] [--visual] [--quality] [--passk N] [--budget N] [--only <substr>] [--spec]', example: 'probevane generate ./my-app --kind unit --mock' },
  { name: 'refactor', summary: 'Characterization-first refactor: change source only, every test stays green (behavior_lock). --quality adds a source-quality gate (edited files mustn\'t regress).', usage: 'probevane refactor <dir> --task "<what to refactor>" [--only <path>] [--model …] [--budget N] [--force-stop-after N] [--quality]', example: 'probevane refactor ./app --task "extract helpers into utils.ts" --quality' },
  { name: 'feature', summary: 'TDD red-first: write a failing test, implement, go green; existing tests protected. --quality gates edited-source quality.', usage: 'probevane feature <dir> --task "<feature>" [--only <path>] [--model …] [--force-stop-after N] [--quality]', example: 'probevane feature ./app --task "add a discount field to cartTotal"' },
  { name: 'repair', summary: 'After source changes, update the affected (stale) tests so the whole suite is green. --quality gates edited-source quality.', usage: 'probevane repair <dir> [--since <ref>] [--only <path>] [--model …] [--force-stop-after N] [--quality]', example: 'probevane repair ./app --since HEAD~1' },
  { name: 'fix', summary: 'Apply described issues/findings to the code, keeping the suite green + audit-clean. --quality gates edited-source quality.', usage: 'probevane fix <dir> --task "<issues>" [--only <path>] [--model …] [--force-stop-after N] [--quality]', example: 'probevane fix ./app --task "handle the null case in parse()"' },
  { name: 'review', summary: 'Read-only quality grade (0–100) of a suite: green, coverage, audit, flake.', usage: 'probevane review <dir> [--flake N]', example: 'probevane review ./app' },
  { name: 'a11y', summary: 'Static accessibility audit of components (missing alt/name/label, click-no-role, positive tabindex) → grade.', usage: 'probevane a11y <dir>', example: 'probevane a11y ./app' },
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
  { name: 'watch', summary: 'Watch src/ and on each save map the file → repair (has a test) or generate (none); --run triggers the loop.', usage: 'probevane watch <dir> [--run] [--debounce ms]', example: 'probevane watch ./app --run' },
  { name: 'skill', summary: 'Generate/check the probevane control skill (this doc). --check fails on drift.', usage: 'probevane skill [--check]', example: 'probevane skill --check' },
  { name: 'distill', summary: "Build a fine-tuning dataset from accepted-test traces (PROBEVANE_TRACES=1) and print the LoRA training plan; serve the result via --model local:.", usage: 'probevane distill <build|stats|train|bases> [--execute] [--models a,b]', example: 'probevane distill build' },
  { name: 'serve', summary: 'Live loop dashboard — tails .probevane/events-*.jsonl and streams steps/gates/tokens/edits to the browser over SSE while the loop runs.', usage: 'probevane serve [dir] [--port N]', example: 'probevane serve ./app' },
  { name: 'improve', summary: 'Screenshot-driven visual improvement loop — capture a page, a vision model judges it against a goal and rewrites the target file until met (visual analogue of the test loop).', usage: 'probevane improve --url <u> --target <file> --goal "<g>" [--selector <css>] [--reload <cmd>] [--max N]', example: 'probevane improve --url http://localhost:4173/x --target src/ui/loop.html --goal "make the header prominent"' },
  { name: 'history', summary: 'Run history + cost ledger — total spend, how much the harness landed alone vs needed takeover vs needed hand-finishing, per-model/per-path breakdown.', usage: 'probevane history [--limit N] [--json]', example: 'probevane history' },
  { name: 'peek', summary: 'Terminal live view of the loop — same event stream as serve, compact table (step/tool/gate/tokens) in the console.', usage: 'probevane peek [dir]', example: 'probevane peek ./app' },
  { name: 'revert', summary: 'Undo a run — restore the files a run edited to its pre-run checkpoint (or remove ones it created), from the diary record. Safety net for a crashed/bad run.', usage: 'probevane revert <runId> [dir]', example: 'probevane revert run-abc123 ./app' },
  { name: 'impact', summary: 'Test-impact analysis — which specs are affected by the diff since <base> (transitive import graph); --run executes only those to speed CI.', usage: 'probevane impact <dir> [--base <ref>] [--run] [--json]', example: 'probevane impact . --base origin/main --run' },
  { name: 'assert-score', summary: 'Assertion-quality grade (0–100) of a suite — flags weak assertions (toBeDefined/toBeTruthy, tautologies, snapshot-only, bare not.toThrow) that pass without testing behavior. Complements audit (assertion-free) + bench (mutation).', usage: 'probevane assert-score <dir> [--json]', example: 'probevane assert-score ./app' },
  { name: 'simcost', summary: 'Simulated cost benchmark — triage a dir into easy/hard modules and compare all-api vs hybrid (local easy + api hard) vs bridge cost, grounded in measured per-module $ from the ledger.', usage: 'probevane simcost [dir] [--easy N --hard M] [--local-hit R] [--json]', example: 'probevane simcost ./app --local-hit 0.6' },
  { name: 'factory', summary: 'Run the gated generate loop over many repos concurrently — each with isolated state, errored repos auto-reverted + retried once — into one cost/coverage/quality rollup (report.json, with an error-mode breakdown). --resume skips repos already accepted in a prior report. Unrecognized flags forward to generate per-repo.', usage: 'probevane factory <repos.txt | dir...> [--concurrency N] [--kind unit|e2e] [--report <path>] [--state-root <dir>] [--resume] [--no-retry] [--no-checkpoint] [...generate flags]', example: 'probevane factory repos.txt --concurrency 4 --model auto' },
  { name: 'quality', summary: 'Project source-quality gate — file size, function length/cyclomatic+cognitive complexity/nesting/params, long lines, debt markers (TODO/FIXME, comment-scoped), import fan-out, and (maximal-block) duplication → a 0–100 health grade. --strict exits 1 on error-severity violations (CI). Complements audit (test specs), assert-score (assertions), bench (mutation).', usage: 'probevane quality <dir> [--strict] [--json] [--max-file N] [--max-fn N] [--max-complexity N] [--max-cognitive N] [--max-nesting N] [--max-params N] [--max-width N] [--max-imports N] [--no-debt]', example: 'probevane quality ./app --strict' },
  { name: 'mfe-audit', summary: 'Micro-frontend (Module Federation) standards gate — per repo: boundaries (no deep cross-remote imports), shared singletons, runtime resilience (Suspense + error boundary), typed contracts; across repos: shared version alignment. Pure analysis ($0, no LLM) → grade + violations; --strict exits 1 (CI). The fitness function the refactor loop enforces.', usage: 'probevane mfe-audit <dir | repos.txt> [--repos <file>] [--json] [--strict] [--design-system <pkg>]', example: 'probevane mfe-audit ./host --strict' },
  { name: 'daemon', summary: 'Long-running OPERATE/OBSERVE + control-center service — an HTML dashboard (/) plus /health, /aggregate (cost+acceptance over time), /alerts (cost spike / acceptance drop / error burst), /audit (library-mutation trail), /jobs, and POST /run (launch an op) + /cancel?id= (kill it). Launched jobs persist to jobs.jsonl (restart-safe); structured log rotates; periodic alert re-eval. Binds 127.0.0.1; read-only over ledgers.', usage: 'probevane daemon [--port N] [--root <stateDir>] [--interval SEC]', example: 'probevane daemon --port 7766' },
  { name: 'ado', summary: 'Azure DevOps board integration — `ado run` polls the board for tagged work items, runs the loop per item, and reports progress back as state moves + comments; `ado create` files a task. Auth via AZURE_DEVOPS_PAT.', usage: 'probevane ado <run|create> [--project P] [--org O] [--tag probevane] [--title "<t>"] [--type Issue]', example: 'probevane ado run --project probevane' },
];

/** Commands accepted by bin/probevane that intentionally aren't user-facing skill entries. */
export const UNDOCUMENTED = new Set(['plan', 'version', '-v', '--version', 'help', '-h', '--help']);

/** Parse the command names the bin dispatcher accepts (the `a|b|c)` case line). */
export async function binCommands(): Promise<string[]> {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'probevane');
  const src = await readFile(bin, 'utf8');
  const m = src.match(/^\s*(init\|[a-z0-9|-]+)\)/m);
  return m ? m[1].split('|') : [];
}
