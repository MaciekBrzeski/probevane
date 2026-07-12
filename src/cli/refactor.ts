import { runPathCliMain } from './path-cli.js';
import { flag } from '../util/args.js';

// probevane refactor <dir> --task "extract / rename / simplify …" [--model …] [--max-steps N]
//
// Characterization-first: the existing test suite is the behavior contract
// (behavior_lock rune). The model changes ONLY source; every passing test must
// stay green. Run `probevane generate` first if the target has no tests.
runPathCliMain(
  'refactor',
  async (args, dir, _cfg, getAdapter) => {
    const task = flag(args, '--task');
    if (!task) {
      console.error('usage: probevane refactor <dir> --task "<what to refactor>"');
      process.exit(2);
    }
    const adapter = await getAdapter();
    console.error(`[probevane] refactor adapter=${adapter.id} dir=${dir}`);
    return [
      `Refactor task: ${task}`,
      ``,
      `Change ONLY source files. Do not edit, add, or delete any test file — the tests are the`,
      `behavior contract and must all stay green. Read the relevant source first, record a plan,`,
      `make the refactor, then ensure typecheck passes and every test that passed before still passes.`,
    ].join('\n');
  },
  { cacheRead: true },
);
