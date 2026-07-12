import { runPathCliMain } from './path-cli.js';
import { flag } from '../util/args.js';

// probevane fix <dir> --task "<issues to fix>" [--model …] [--budget N]
//
// Apply review findings (or any described fixes) to the code, keeping the whole
// test suite green and audit-clean (`fix` profile). Used standalone or by
// `probevane ci --review-fix`.
runPathCliMain('fix', (args) => {
  const task = flag(args, '--task');
  if (!task) {
    console.error('usage: probevane fix <dir> --task "<issues to fix>"');
    process.exit(2);
  }
  return [
    `Fix the following issues. Edit source (or a test only if the test itself is wrong).`,
    `Keep the WHOLE test suite green and audit-clean; do not suppress or weaken tests to hide a problem.`,
    `Read the relevant files and record a plan first.`,
    ``,
    task,
  ].join('\n');
});
