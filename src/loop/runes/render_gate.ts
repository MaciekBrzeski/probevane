import type { Rune, RuneDecision } from '../rune.js';
import { tail } from '../../util/text.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { sh } from '../../util/exec.js';
import { capture as defaultCapture } from '../../visual/capture.js';
import { visionAsk as defaultAsk } from '../../visual/vision.js';

// render_gate — the VISUAL acceptance oracle. Where the test paths gate on "the
// tests I wrote pass", a visual change gates on "the running app renders cleanly
// AND matches the goal". On the model's intent to finish this: (optionally)
// triggers a rebuild/HMR, screenshots the live app, checks a perf budget, and asks
// a vision model whether the scene shows no rendering defects and satisfies the
// goal — blocking with the critique (fed back into the loop) until it does. The
// unit suite staying green is enforced separately by behavior_lock in the profile.

export interface RenderGateOpts {
  /** URL of the running app to screenshot (a dev server started out of band). */
  url: string;
  /** What the change should achieve — handed to the vision judge. */
  goal: string;
  selector?: string;
  /** Optional command to rebuild / trigger HMR before the screenshot. */
  reloadCmd?: string;
  /** Optional perf-budget command; a non-zero exit blocks the finish. */
  perfCmd?: string;
  settleMs?: number;
  /** Vision judges per check; >1 runs an adversarial majority vote (default 1). */
  votes?: number;
  outDir?: string;
  // Injectable seams (tests): default to the real capture/vision/shell.
  capture?: typeof defaultCapture;
  ask?: typeof defaultAsk;
  runCmd?: (cmd: string, cwd: string) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
}

const RENDER_SYSTEM =
  'You are a strict graphics QA reviewer. You are shown a screenshot of a running app after a rendering change. ' +
  'Judge ONLY what is visible. Reply with a single line starting with exactly PASS or FAIL, then a colon and a short concrete reason.';

/** The vision judge's question: defect check + goal check, forced into a PASS/FAIL verdict line. */
function judgePrompt(goal: string): string {
  return [
    `Goal of the change: ${goal}`,
    '',
    'Does the rendered scene (a) show NO rendering defects (black/blank screen, missing or exploded geometry,',
    'obvious clipping, z-fighting, NaN/garbage artifacts) AND (b) visibly satisfy the goal?',
    'Answer strictly: start with PASS or FAIL, then ": <reason>".',
  ].join('\n');
}

const isPass = (verdict: string): boolean => /^\s*pass\b/i.test(verdict);

/** Run the vision judge(s); a strict majority of PASS is required. */
async function judge(opts: RenderGateOpts, png: string): Promise<{ pass: boolean; reasons: string[] }> {
  const ask = opts.ask ?? defaultAsk;
  const n = Math.max(1, opts.votes ?? 1);
  const verdicts: string[] = [];
  for (let i = 0; i < n; i++) verdicts.push(await ask(png, RENDER_SYSTEM, judgePrompt(opts.goal)));
  const passes = verdicts.filter(isPass).length;
  return { pass: passes * 2 > n, reasons: verdicts };
}

/** Gate body: optional reload → screenshot the live app → optional perf budget →
 *  vision verdict; each failure blocks with actionable output. */
async function renderShouldStop(ctx: RunCtx, opts: RenderGateOpts): Promise<RuneDecision> {
  const run = opts.runCmd ?? sh;
  const cap = opts.capture ?? defaultCapture;
  if (opts.reloadCmd) {
    const r = await run(opts.reloadCmd, ctx.workdir);
    if (!r.ok) return block('render_gate: reload command failed', tail(r.stdout + r.stderr, 2000));
  }
  const dir = opts.outDir ?? join(ctx.workdir, '.probevane', 'shots');
  await mkdir(dir, { recursive: true });
  const png = join(dir, `render-${Date.now()}.png`);
  let shot: string;
  try {
    shot = await cap(opts.url, png, { selector: opts.selector, settleMs: opts.settleMs });
  } catch (e) {
    return block(
      'render_gate: could not capture the app',
      `Failed to screenshot ${opts.url} — is the dev server running?\n${String(e)}`,
    );
  }
  if (opts.perfCmd) {
    const r = await run(opts.perfCmd, ctx.workdir);
    if (!r.ok) return block('render_gate: perf budget exceeded', tail(r.stdout + r.stderr, 2000));
  }
  const { pass, reasons } = await judge(opts, shot);
  if (!pass) {
    return block(
      'render_gate: visual check failed',
      `A vision reviewer judged the render does not yet meet the goal:\n- ${reasons.join('\n- ')}\n` +
        'Adjust the render/shader/material source and finish again.',
    );
  }
  return ALLOW;
}

/** Build the visual-acceptance rune over the given app URL + goal. */
export function renderGate(opts: RenderGateOpts): Rune {
  return {
    name: 'render_gate',
    systemPromptAddition: () =>
      'VISUAL TASK: edit the render/shader/material source to achieve the visual goal. On finish, a vision reviewer ' +
      'screenshots the running app and judges whether it renders cleanly and matches the goal — iterate on its ' +
      'feedback until it passes. Do NOT edit test files; the existing suite must stay green.',
    shouldStop: (ctx) => renderShouldStop(ctx, opts),
  };
}

