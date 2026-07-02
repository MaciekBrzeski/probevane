import { runPathCliMain } from './path-cli.js';
import { flag } from './args.js';

// probevane feature <dir> --task "add discount to cartTotal …" [--model …] [--max-steps N]
//
// TDD red-first (red_first rune): the model writes a NEW test that fails against
// the current code, then implements the feature in source until it passes;
// pre-existing tests stay green (no_regression).
runPathCliMain(
  'feature',
  async (args, dir, _cfg, getAdapter) => {
    const task = flag(args, '--task');
    if (!task) {
      console.error('usage: probevane feature <dir> --task "<feature to add>"');
      process.exit(2);
    }
    const adapter = await getAdapter();
    console.error(`[probevane] feature adapter=${adapter.id} dir=${dir}`);
    return [
      `Feature task: ${task}`,
      ``,
      `Work test-first (TDD): FIRST add a NEW test that specifies this feature and FAILS against the`,
      `current code. Then implement the feature in source until that test passes. Do not change or`,
      `weaken existing tests — they must stay green. Read the relevant files and record a plan first.`,
    ].join('\n');
  },
  { maxStepsDefault: 32, cacheRead: true },
);
