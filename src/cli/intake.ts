import { resolve } from 'node:path';
import { buildSpec } from '../spec-run/build-spec.js';
import { saveSpec, specToArgv, validateRunSpec, isDarkRunnable } from '../spec-run/runspec.js';
import { flag, positionals } from './args.js';

// probevane intake "<prompt>" <dir> [--answers f.json | --interactive]
//                  [--model m] [--takeover t] [--strict] [--json] [--root <state>]
//
// Turn a simple NL prompt into a frozen, machine-checkable RunSpec: classify the
// path, ask the few clarifying questions (or read a policy file), and persist
// <state>/specs/<id>.json. That spec IS the specification a dark run executes.
const VALUE_FLAGS = ['--answers', '--model', '--takeover', '--root'];

async function main() {
  const args = process.argv.slice(2);
  const pos = positionals(args, VALUE_FLAGS);
  const prompt = pos[0];
  const dir = resolve(pos[1] ?? '.');
  if (!prompt) {
    console.error('usage: probevane intake "<prompt>" <dir> [--answers f.json | --interactive] [--json]');
    process.exit(2);
  }

  const spec = await buildSpec(prompt, dir, args);
  const errs = validateRunSpec(spec);
  if (errs.length) {
    console.error(`[probevane] invalid spec:\n- ${errs.join('\n- ')}`);
    process.exit(1);
  }
  const path = await saveSpec(spec, flag(args, '--root'));

  if (args.includes('--json')) {
    console.log(JSON.stringify(spec, null, 2));
    return;
  }
  console.log(`[probevane] intake → ${spec.path} (${spec.kind})${isDarkRunnable(spec) ? '' : ' — not dark-runnable'}`);
  console.log(`  spec:  ${path}`);
  console.log(`  runs:  probevane ${specToArgv(spec).join(' ')}`);
  if (spec.decompose?.perFile) console.log('  decompose: per-file (expanded at factory-dark time)');
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
