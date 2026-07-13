import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { capture } from './capture.js';
import { visionAsk } from './vision.js';
import { sh } from '../util/exec.js';

// Screenshot-driven improvement loop: render → capture → a vision model JUDGES
// it against a goal → if unmet, it rewrites the target file (one focused change)
// → reload → re-capture → repeat. The visual analogue of the gated test loop.
export interface ImproveOpts {
  url: string;
  selector?: string;
  goal: string;
  targetFile: string;
  reloadCmd?: string; // run after each edit before re-capturing (e.g. restart a server)
  maxIters?: number;
  outDir: string;
  width?: number;
  log?: (l: string) => void;
}

const SYSTEM =
  'You are a UI reviewer improving a rendered page toward a goal. You see a screenshot and the source file that controls it. Make ONE focused, incremental change per turn. Keep all existing functionality. Reply EXACTLY "DONE" if the goal is already met; otherwise reply with ONLY the complete revised file inside a single fenced code block — no prose.';

// First fenced code block of a reply (the rewritten file), or null when the model didn't comply.
export function extractFence(text: string): string | null {
  const m = text.match(/```[a-z]*\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}

// The capture→judge→rewrite loop: one focused edit per iteration until DONE or maxIters.
export async function improveLoop(opts: ImproveOpts): Promise<{ iterations: number; done: boolean; shots: string[] }> {
  const log = opts.log ?? (() => {});
  const max = opts.maxIters ?? 4;
  await mkdir(opts.outDir, { recursive: true });
  const shots: string[] = [];

  for (let i = 1; i <= max; i++) {
    const shot = join(opts.outDir, `iter-${i}.png`);
    await capture(opts.url, shot, { selector: opts.selector, width: opts.width, settleMs: 2000 });
    shots.push(shot);
    const content = await readFile(opts.targetFile, 'utf8');
    const reply = await visionAsk(
      shot,
      SYSTEM,
      `GOAL: ${opts.goal}\n\nThe screenshot is the CURRENT render. The file controlling it is ${opts.targetFile}:\n\n${content}`,
    );
    if (/^DONE\b/i.test(reply.trim())) {
      log(`[improve] goal met after ${i - 1} edit(s)`);
      return { iterations: i, done: true, shots };
    }
    const next = extractFence(reply);
    if (!next) {
      log(`[improve] no edit proposed at iter ${i} — stopping`);
      return { iterations: i, done: false, shots };
    }
    await writeFile(opts.targetFile, next.endsWith('\n') ? next : next + '\n');
    log(`[improve] iter ${i}: applied an edit to ${opts.targetFile}`);
    if (opts.reloadCmd) await sh(opts.reloadCmd, process.cwd()).catch(() => {});
  }
  log(`[improve] reached max ${max} iteration(s)`);
  return { iterations: max, done: false, shots };
}
