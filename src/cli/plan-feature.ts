import { readFileSync, writeFileSync } from 'node:fs';
import { planFeature, renderMarkdown, type PlanMode } from '../planner/planner.js';
import { flag, num } from '../util/args.js';

// probevane plan-feature --from "<current>" --to "<desired>" [--from-file f] [--to-file f]
//     [--model local:<id>|ollama:<id>] [--mode auto|fim|chat] [--steps N] [--json] [--out f]
//
// The feature planner: give it the CURRENT state and the DESIRED state and a LOCAL model
// fills in the middle — the detailed, ordered steps between them. Fill-in-the-middle
// (prefix=current, suffix=desired) when the model supports it, chat framing otherwise.

const DEFAULT_MODEL = process.env.PROBEVANE_PLAN_MODEL ?? 'local:mk-coder:lora-v8';

/** Resolve a state from `--x "text"` or `--x-file path`. */
function state(args: string[], name: string): string | undefined {
  const inline = flag(args, `--${name}`);
  if (inline !== undefined) return inline;
  const file = flag(args, `--${name}-file`);
  if (file !== undefined) return readFileSync(file, 'utf8');
  return undefined;
}

// Entry: read the two states, run the local planner, print or --out the plan.
// Exits 2 on missing states, 1 when the planner fails.
async function main() {
  const args = process.argv.slice(2);
  const from = state(args, 'from');
  const to = state(args, 'to');
  if (!from || !to) {
    console.error(
      'usage: probevane plan-feature --from "<current>" --to "<desired>"\n' +
        '       [--from-file f] [--to-file f] [--model local:<id>|ollama:<id>]\n' +
        '       [--mode auto|fim|chat] [--steps N] [--json] [--out file]',
    );
    process.exit(2);
  }
  const model = flag(args, '--model') ?? DEFAULT_MODEL;
  const mode = (flag(args, '--mode') ?? 'auto') as PlanMode;
  const steps = args.includes('--steps') ? num(args, '--steps', 0) || undefined : undefined;

  let plan;
  try {
    plan = await planFeature(from, to, { model, mode, steps });
  } catch (e) {
    console.error(`[probevane] plan-feature failed: ${(e as Error).message}`);
    process.exit(1);
  }

  const out = flag(args, '--out');
  const body = args.includes('--json') ? JSON.stringify(plan, null, 2) : renderMarkdown(plan);
  if (out) {
    writeFileSync(out, body.endsWith('\n') ? body : body + '\n');
    console.error(`[probevane] plan-feature → ${out} (${plan.steps.length} steps, ${plan.mode}, ${plan.model})`);
  } else {
    console.log(body);
  }
}

main();
