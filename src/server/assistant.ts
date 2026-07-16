import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { classifyPrompt } from '../spec-run/classify.js';
import { buildSpec } from '../spec-run/build-spec.js';
import { specToLaunchPlan } from '../spec-run/runspec.js';
import { gatherPlan } from '../spec-run/gather.js';
import { buildGraph } from '../mock/graph.js';
import { pyramidReport } from '../commands/arch/pyramid.js';
import { crowdingReport } from '../commands/arch/crowding.js';
import { loadConfig } from '../util/config.js';
import type { Interpretation, Proposal, AssistantPlanItem } from '../util/assistant-shape.js';

// The conversational assistant driver — DETERMINISTIC, $0 (no brain, no run). It
// turns a request into a confirmable launch plan (interpret) and, after a run,
// into ranked improvement follow-ups (propose). The model only drives the actual
// loop, launched separately via POST /run with interpret()'s launch body.

/** Human-readable "assumed X" lines from the classifier's still-open questions —
 *  surfaced so the user can correct a misread before confirming. */
function assumptionsFrom(questions: { field: string; def: string }[]): string[] {
  const label: Record<string, (d: string) => string> = {
    path: (d) => `assumed the "${d}" path — rephrase to change`,
    scope: (d) => `assumed ${d} tests — say "e2e"/"unit" to change`,
    ship: (d) => (d === 'no' ? 'will NOT open a PR (say "and ship it" to enable)' : 'will open a PR on accept'),
    takeover: (d) => `rescue model: ${d}`,
  };
  return questions.map((q) => label[q.field]?.(q.def)).filter((x): x is string => !!x);
}

/** Interpret an NL request into a confirmable launch plan + $0 plan context. */
export async function interpret(dir: string, prompt: string, model?: string): Promise<Interpretation> {
  const abs = resolve(dir);
  if (!(await stat(abs).then((s) => s.isDirectory()).catch(() => false))) {
    return blankInterpretation(prompt, `not a directory: ${abs}`);
  }
  if (!prompt.trim()) return blankInterpretation(prompt, 'empty request');

  const spec = await buildSpec(prompt, abs, model ? ['--model', model] : []);
  const launch = specToLaunchPlan(spec);
  const { confidence, questions } = classifyPrompt(prompt);
  // gatherPlan is best-effort context — a repo with no adapter still interprets.
  const planContext = await gatherPlan(abs, spec.kind)
    .then((g) => g.plan.items.map(toItem))
    .catch(() => [] as AssistantPlanItem[]);

  return {
    ok: true, prompt, op: launch.op, kind: spec.kind, only: spec.only,
    confidence, assumptions: assumptionsFrom(questions), launch, planContext,
    summary: `${launch.op}${spec.only ? ` --only ${spec.only}` : ''} on ${abs}` +
      `${spec.task ? ` — "${spec.task}"` : ''} (model ${spec.model ?? 'auto'})`,
  };
}

const toItem = (i: { action: string; target: string; why: string; priority: number }): AssistantPlanItem => ({
  action: i.action, target: i.target, why: i.why, priority: i.priority,
});

/** An unusable-request interpretation (ok:false) the card renders as an error. */
function blankInterpretation(prompt: string, error: string): Interpretation {
  return {
    ok: false, error, prompt, summary: error, op: '', kind: 'unit',
    confidence: 0, assumptions: [], planContext: [],
    launch: { op: '', dir: '', flags: [] },
  };
}

/** Map a plan item's action to the op + flags a follow-up run would use. */
function itemProposal(i: AssistantPlanItem): Proposal | null {
  const map: Record<string, { op: string; flags: (t: string) => string[] }> = {
    generate: { op: 'generate', flags: (t) => ['--kind', 'unit', '--only', t, '--max-targets', '1'] },
    refactor: { op: 'refactor', flags: (t) => ['--task', `refactor ${t} to satisfy the quality gate`, '--only', t, '--quality'] },
    fix: { op: 'fix', flags: (t) => ['--task', `fix the issues in ${t}`, '--only', t] },
    'mfe-fix': { op: 'mfe-audit', flags: () => ['--strict'] },
  };
  const m = map[i.action];
  if (!m) return null;
  return { title: `${i.action}: ${i.target}`, why: i.why, op: m.op, flags: m.flags(i.target), source: 'plan' };
}

/** Post-run $0 improvement follow-ups: the ranked plan, then structural (pyramid/
 *  crowding) hints, each as a one-click runnable next request. Deterministic. */
export async function propose(dir: string): Promise<Proposal[]> {
  const abs = resolve(dir);
  const out: Proposal[] = [];

  const kind = 'unit' as const;
  const items = await gatherPlan(abs, kind).then((g) => g.plan.items.map(toItem)).catch(() => []);
  for (const i of items.sort((a, b) => b.priority - a.priority).slice(0, 5)) {
    const p = itemProposal(i);
    if (p) out.push(p);
  }

  // Structural hints are advisory (arch is report-only) — surfaced as documented
  // suggestions the user can act on, not auto-runnable fix ops.
  const roles = (await loadConfig(abs)).arch ?? {};
  const graph = await buildGraph(abs).catch(() => null);
  if (graph) {
    for (const v of pyramidReport(graph, roles).violations.slice(0, 2)) {
      out.push({
        title: `structure: ${v.kind} ${v.from} → ${v.to}`, why: v.fix,
        op: 'arch', flags: ['--pyramid'], source: 'pyramid',
      });
    }
    for (const c of crowdingReport(graph, roles.maxFiles ?? 15).slice(0, 1)) {
      out.push({
        title: `crowding: ${c.dir}/ (${c.files} files)`,
        why: c.clusters[0] ? `subfolder candidate: ${c.clusters[0].prefix}/` : 'over the file cap — consider splitting',
        op: 'arch', flags: ['--pyramid'], source: 'crowding',
      });
    }
  }
  return out;
}
