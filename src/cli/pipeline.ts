import { writeFileSync } from 'node:fs';
import { describePipeline, pipelineMermaid, fullModel, PHASES, type Phase } from '../loop/describe.js';
import type { ProfileName, ProfileOpts } from '../loop/profiles.js';
import { flag } from '../util/args.js';

// probevane pipeline — describe the loop pipeline a config assembles, WITHOUT running it.
//   probevane pipeline --profile feature --kind unit [--quality --mutation --flake --a11y
//                       --visual --mfe --min-tests N --min-coverage P --assert-min N]
//   flags:  --json            emit the structured pipeline (rune/hook/phase) as JSON
//           --mermaid <out>   write a phase-grouped Mermaid flowchart to a file
//           --emit-model <f>  write the all-profiles client model (for the wiki demo)
// The pipeline is a pure function of the config (src/loop/profiles.ts) — this just reads it.

const PROFILES = ['write_tests', 'feature', 'refactor', 'repair', 'fix', 'migrate', 'document', 'bare'];

function has(args: string[], name: string): boolean {
  return args.includes(name);
}
function num(v: string | undefined): number | undefined {
  return v === undefined ? undefined : Number(v);
}

function buildOpts(args: string[]): ProfileOpts {
  return {
    kind: flag(args, '--kind') === 'e2e' ? 'e2e' : 'unit',
    minTests: num(flag(args, '--min-tests')),
    minCoverage: num(flag(args, '--min-coverage')),
    assertMin: num(flag(args, '--assert-min')),
    mutation: has(args, '--mutation'),
    flakeGuard: has(args, '--flake'),
    a11y: has(args, '--a11y'),
    visual: has(args, '--visual'),
    quality: has(args, '--quality'),
    mfe: has(args, '--mfe'),
  };
}

// Default: human-readable phase-grouped listing + the Mermaid block.
function printDefault(name: ProfileName, opts: ProfileOpts, desc: ReturnType<typeof describePipeline>): void {
  console.log(`pipeline: ${name} (kind=${opts.kind}) — ${desc.runes.length} rune(s)`);
  for (const { id, label } of PHASES) {
    const rs = desc.runes.filter((r) => r.phase === (id as Phase));
    if (!rs.length) continue;
    console.log(`  ${label}:`);
    for (const r of rs) console.log(`    - ${r.name}  [${r.hooks.join(', ')}]`);
  }
  console.log('');
  console.log(pipelineMermaid(desc.runes));
}

function main() {
  const args = process.argv.slice(2);

  if (has(args, '--emit-model')) {
    const out = flag(args, '--emit-model')?.replace(/^--.*/, '')
      || new URL('../../docs/wiki/pipeline-model.json', import.meta.url).pathname;
    writeFileSync(out, JSON.stringify(fullModel(), null, 2) + '\n');
    console.log(`[pipeline] wrote model (${PROFILES.length} profiles) -> ${out}`);
    return;
  }

  const name = (flag(args, '--profile') ?? 'write_tests') as ProfileName;
  if (!PROFILES.includes(name)) {
    console.error(`[pipeline] unknown profile '${name}' (one of: ${PROFILES.join(', ')})`);
    process.exit(2);
  }
  const opts = buildOpts(args);
  const desc = describePipeline(name, opts);

  if (has(args, '--json')) {
    console.log(JSON.stringify(desc, null, 2));
    return;
  }

  const mer = flag(args, '--mermaid');
  if (mer !== undefined && mer) {
    writeFileSync(mer, pipelineMermaid(desc.runes) + '\n');
    console.log(`[pipeline] wrote Mermaid -> ${mer}`);
    return;
  }

  printDefault(name, opts, desc);
}

main();
