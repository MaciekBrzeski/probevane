import { resolve } from 'node:path';
import { improveLoop } from '../visual/improve.js';

// probevane improve --url <u> --target <file> --goal "<g>" [--selector <css>] [--reload "<cmd>"] [--max N] [--out <dir>]
//
// Screenshot-driven visual improvement: capture the page, a vision model judges
// it against the goal and rewrites the target file until the goal is met. The
// visual analogue of the gated test loop. Needs ANTHROPIC_API_KEY + chromium.
async function main() {
  const a = process.argv.slice(2);
  const url = flag('--url');
  const targetFile = flag('--target');
  const goal = flag('--goal');
  if (!url || !targetFile || !goal) {
    console.error('usage: probevane improve --url <u> --target <file> --goal "<g>" [--selector <css>] [--reload "<cmd>"] [--max N] [--out <dir>]');
    process.exit(2);
  }
  const out = await improveLoop({
    url,
    targetFile: resolve(targetFile),
    goal,
    selector: flag('--selector'),
    reloadCmd: flag('--reload'),
    maxIters: parseInt(flag('--max') ?? '4', 10),
    outDir: resolve(flag('--out') ?? '.probevane/improve'),
    width: flag('--width') ? parseInt(flag('--width')!, 10) : undefined,
    log: (l) => console.error(l),
  });
  console.log(`[probevane] improve: ${out.done ? 'GOAL MET' : 'not converged'} in ${out.iterations} iteration(s). Shots: ${out.shots.join(', ')}`);
  if (!out.done) process.exit(1);

  function flag(name: string): string | undefined {
    const i = a.indexOf(name);
    return i >= 0 ? a[i + 1] : undefined;
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
