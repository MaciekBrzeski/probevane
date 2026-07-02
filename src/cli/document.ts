import { runPathCliMain } from './path-cli.js';
import { flag } from './args.js';

// probevane document <dir> [--only <path>] [--task "<focus>"] [--model …] [--force-stop-after N]
//
// Add documentation only — JSDoc/TSDoc on exported APIs, clarifying comments on
// non-obvious logic. No behavior change: tests + typecheck must stay green
// (behavior_lock). Use --only to focus one file/area.
runPathCliMain(
  'document',
  async (args, dir, _cfg, getAdapter) => {
    const focus = flag(args, '--task');
    const adapter = await getAdapter();
    console.error(`[probevane] document adapter=${adapter.id} dir=${dir}`);
    return [
      `Documentation task${focus ? `: ${focus}` : ': add JSDoc/TSDoc to exported APIs and clarify non-obvious logic'}.`,
      ``,
      `Add ONLY documentation — JSDoc/TSDoc comments on exported functions/types/classes (params,`,
      `returns, throws) and short comments on non-obvious logic. Do NOT change behavior, signatures,`,
      `or logic. Tests and typecheck must stay green afterward.`,
    ].join('\n');
  },
  { quality: false },
);
