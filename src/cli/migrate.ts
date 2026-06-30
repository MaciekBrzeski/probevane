import { flag, runPathCliMain } from './path-cli.js';

// probevane migrate <dir> --task "<migration>" | --to <pkg@version>
//                   [--only <path>] [--model …] [--quality] [--mfe] [--force-stop-after N]
//
// Codemod / framework-version migration: change source to the new API/version while
// every existing test stays green (behavior_lock). Run `probevane repair` after if
// a migration legitimately changes test expectations.
runPathCliMain('migrate', async (args, dir, _cfg, getAdapter) => {
  const task = flag(args, '--task');
  const to = flag(args, '--to');
  if (!task && !to) {
    console.error('usage: probevane migrate <dir> --task "<migration>" | --to <pkg@version>');
    process.exit(2);
  }
  const adapter = await getAdapter();
  console.error(`[probevane] migrate adapter=${adapter.id} dir=${dir}`);

  const what = task ?? `migrate to ${to}`;
  return [
    `Migration task: ${what}.`,
    ``,
    `Update SOURCE to the new API/version. Every existing test must still pass — do not weaken or`,
    `delete tests to make them pass (that is the behavior contract). Read the affected source first,`,
    `record a plan, apply the migration consistently, then ensure typecheck + the full suite stay green.`,
  ].join('\n');
});
