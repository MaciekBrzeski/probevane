// Deterministic action-plan builder (Slice 1). Pure: given read-only signals
// (untested targets, coverage gaps, quality errors, MFE standards errors) it ranks
// a concrete to-do list — what to `generate` / `refactor` / `fix` / `mfe-fix` on a
// project, no LLM. The CLI gathers the signals (I/O); this assembles + ranks them.

export type PlanAction = 'generate' | 'refactor' | 'fix' | 'mfe-fix';

/** One ranked to-do: which probevane action to run on which target, and why.
 *  Assembled and prioritized by buildPlan. */
export interface PlanItem {
  action: PlanAction;
  target: string; // file or repo the action applies to
  why: string;
  priority: number; // higher = do first
}

/** The read-only signals the CLI gathers for the planner — untested files,
 *  thin coverage, quality errors, MFE standards errors. */
export interface PlanInput {
  untested: string[]; // source files with no spec
  coverageGaps: string[]; // files below coverage (already-tested but thin)
  qualityErrors: { file: string; message: string }[];
  mfeErrors: { message: string; file?: string }[];
}

const base = (p: string) =>
  p.split('/').pop()!.replace(/\.(test|spec)\.[tj]sx?$/, '').replace(/\.[tj]sx?$/, '').replace(/\.py$/, '');

/** Source files with no spec referencing them (heuristic: basename not in any spec path). */
export function untestedTargets(targets: { sourcePath: string }[], specs: string[]): string[] {
  const blob = specs.join('\n');
  return targets.filter((t) => !blob.includes(base(t.sourcePath))).map((t) => t.sourcePath);
}

/** The ranked plan plus its one-line summary — what `probevane plan` prints. */
export interface ProjectPlan {
  items: PlanItem[];
  summary: string;
}

/** Rank the signals into a prioritized action plan. */
export function buildPlan(input: PlanInput): ProjectPlan {
  const items: PlanItem[] = [];
  const seen = new Set<string>(); // dedup by action+target

  const add = (action: PlanAction, target: string, why: string, priority: number) => {
    const key = `${action}:${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ action, target, why, priority });
  };

  for (const e of input.mfeErrors) add('mfe-fix', e.file ?? '(project)', e.message, 4);
  for (const e of input.qualityErrors) add('refactor', e.file, e.message, 3);
  for (const f of input.untested) add('generate', f, 'no tests', 2);
  for (const f of input.coverageGaps) add('generate', f, 'coverage gap', 1);

  items.sort((a, b) => b.priority - a.priority || a.target.localeCompare(b.target));

  const byAction = (a: PlanAction) => items.filter((i) => i.action === a).length;
  const summary =
    `${items.length} action(s): ${byAction('generate')} generate, ${byAction('refactor')} refactor, ` +
    `${byAction('fix')} fix, ${byAction('mfe-fix')} mfe-fix`;
  return { items, summary };
}

/** Render the plan for the terminal: one block per item with the why and the
 *  exact command to run — or the friendly nothing-to-do line. */
export function formatPlan(plan: ProjectPlan): string {
  if (!plan.items.length) return 'Nothing to do — no untested targets, coverage gaps, or standards errors found.';
  const cmd: Record<PlanAction, string> = {
    generate: 'probevane generate',
    refactor: 'probevane refactor --quality',
    fix: 'probevane fix',
    'mfe-fix': 'probevane refactor --mfe',
  };
  return plan.items
    .map((i) => `[${i.action}] ${i.target}\n    why: ${i.why}\n    → ${cmd[i.action]} ${i.target.startsWith('(') ? '.' : i.target}`)
    .join('\n');
}
