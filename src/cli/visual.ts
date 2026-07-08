import { runPathCliMain } from './path-cli.js';
import { flag, num } from './args.js';

// probevane visual <dir> --url <running-app-url> --goal "<what to achieve>"
//   [--task "<hint>"] [--reload "<cmd>"] [--perf-cmd "<cmd>"] [--selector <css>]
//   [--vision-votes N] [--settle <ms>] [--model …] [--budget N] [--only <path>]
//
// The VISUAL path: edit render/shader/material source to hit a visual goal. The
// existing test suite stays green (behavior_lock) and the acceptance oracle is
// render_gate — a running app is screenshotted and a vision model judges whether
// it renders cleanly and matches the goal (+ optional perf budget), feeding its
// critique back into the loop until it passes. Start the dev server first; pass
// its URL. $0 vision via PROBEVANE_VISION_BASE (ollama) or claude with credits.
runPathCliMain(
  'visual',
  async (args, dir, _cfg, getAdapter) => {
    const url = flag(args, '--url');
    const goal = flag(args, '--goal');
    if (!url || !goal) {
      console.error(
        'usage: probevane visual <dir> --url <running-app-url> --goal "<what to achieve>" ' +
          '[--task "<hint>"] [--reload "<cmd>"] [--perf-cmd "<cmd>"] [--selector <css>] [--vision-votes N] [--model …]',
      );
      process.exit(2);
    }
    const adapter = await getAdapter();
    console.error(`[probevane] visual adapter=${adapter.id} dir=${dir} → judging ${url}`);
    const hint = flag(args, '--task');
    return [
      `Visual/graphics task: ${goal}.${hint ? ` ${hint}` : ''}`,
      ``,
      `Edit the RENDER / shader / material / geometry source to achieve the goal. Do NOT change or add any test`,
      `file — the existing suite is the safety net and must stay green. When you finish, a vision reviewer will`,
      `screenshot the running app at ${url} and judge whether it renders cleanly and matches the goal; use its`,
      `feedback to iterate until it passes.`,
    ].join('\n');
  },
  {
    quality: false,
    extraOpts: (args) => ({
      render: {
        url: flag(args, '--url')!,
        goal: flag(args, '--goal')!,
        selector: flag(args, '--selector'),
        reloadCmd: flag(args, '--reload'),
        perfCmd: flag(args, '--perf-cmd'),
        votes: num(args, '--vision-votes', 1),
        settleMs: num(args, '--settle', 1500),
      },
    }),
  },
);
