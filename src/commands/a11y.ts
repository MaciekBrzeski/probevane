import { join, relative } from 'node:path';
import { readdir, readFile, appendFile } from 'node:fs/promises';
import { auditSource, formatViolations } from '../audit/core.js';
import { a11yRules } from '../audit/a11y-rules.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane a11y` backend — static accessibility audit of component source
// (JSX/Vue/Svelte): missing alt/accessible-name/label, click-without-role,
// positive tabindex, etc. Read-only, no LLM; exit 1 on any error-severity
// violation. Logic moved verbatim from the old src/cli/a11y.ts shell; the
// vane interpreter owns argv.
const COMPONENT_RE = /\.(tsx|jsx|vue|svelte)$/;
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

/** Walk ctx.dir/src for component sources, run the static a11y rules over each,
 *  then print the graded markdown (mirrored to $GITHUB_STEP_SUMMARY in Actions). */
export async function run(ctx: CommandCtx): Promise<void> {
  const dir = ctx.dir;
  const files = (await walk(join(dir, 'src')).catch(() => [])).filter((f) => COMPONENT_RE.test(f) && !/\.(test|spec)\./.test(f));
  const rules = a11yRules();

  let errors = 0;
  let warns = 0;
  const lines: string[] = [];
  for (const abs of files) {
    const src = await readFile(abs, 'utf8').catch(() => '');
    const v = auditSource(relative(dir, abs), src, rules);
    errors += v.filter((x) => x.severity === 'error').length;
    warns += v.filter((x) => x.severity === 'warn').length;
    if (v.length) lines.push(formatViolations(v));
  }

  const grade = Math.max(0, 100 - errors * 15 - warns * 5);
  const md = [
    `### ♿ probevane a11y`,
    ``,
    `**Grade: ${grade}/100** — ${files.length} component file(s), ${errors} error(s), ${warns} warning(s)`,
    lines.length ? '\n```\n' + lines.join('\n') + '\n```' : '\n✅ No static accessibility issues found.',
    '',
  ].join('\n');
  console.log(md);
  const s = process.env.GITHUB_STEP_SUMMARY;
  if (s) await appendFile(s, md + '\n').catch(() => {});
  if (errors > 0) process.exit(1);
}

/** Recursive file listing under dir, skipping vendored/build dirs (SKIP). */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      out.push(...(await walk(join(dir, e.name))));
    } else out.push(join(dir, e.name));
  }
  return out;
}
