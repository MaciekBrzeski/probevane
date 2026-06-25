import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { readTraces } from '../distill/collect.js';
import { buildExamples, splitExamples, statsByStack } from '../distill/dataset.js';

// probevane distill <build|stats|train>
//   build   traces → train.jsonl/val.jsonl (quality-filtered, deduped)
//   stats   count + per-stack breakdown of collected traces
//   train   print the LoRA training plan (DRY by default; --execute runs it)
//
// Collect traces first by running the loop with PROBEVANE_TRACES=1.
const OUT = join(homedir(), '.local/share/probevane/distill');

async function main() {
  const sub = process.argv[2] ?? 'stats';
  const traces = await readTraces();

  if (sub === 'stats') {
    const by = statsByStack(traces);
    console.log(`[distill] ${traces.length} trace(s) collected`);
    for (const [stack, n] of Object.entries(by)) console.log(`  ${stack}: ${n}`);
    if (!traces.length) console.log('  (none yet — run the loop with PROBEVANE_TRACES=1 to collect)');
    return;
  }

  if (sub === 'build') {
    const ex = buildExamples(traces);
    const { train, val } = splitExamples(ex);
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, 'train.jsonl'), train.map((e) => JSON.stringify(e)).join('\n') + '\n');
    await writeFile(join(OUT, 'val.jsonl'), val.map((e) => JSON.stringify(e)).join('\n') + '\n');
    console.log(`[distill] built ${ex.length} example(s) from ${traces.length} trace(s) → ${OUT}/{train,val}.jsonl (${train.length}/${val.length})`);
    return;
  }

  if (sub === 'train') {
    const execute = process.argv.includes('--execute');
    const base = arg('--base') ?? 'Qwen/Qwen2.5-Coder-7B-Instruct';
    const cmd = `python scripts/train_lora.py --base ${base} --data ${OUT}/train.jsonl --val ${OUT}/val.jsonl --out ${OUT}/adapter`;
    console.log('[distill] LoRA training plan (RDNA4 ROCm):');
    console.log(`  base:     ${base}`);
    console.log(`  data:     ${OUT}/train.jsonl`);
    console.log(`  adapter:  ${OUT}/adapter`);
    console.log(`  serve:    vLLM/llama.cpp OpenAI server → probevane generate --model local:<name>`);
    console.log(`  command:  ${cmd}`);
    if (!execute) {
      console.log('\n[distill] DRY RUN — not started (GPU). Re-run with --execute when the GPU is free.');
      return;
    }
    console.error('[distill] --execute requested: launch the command above in the RDNA4 venv (HIP_VISIBLE_DEVICES=0, no HSA_OVERRIDE).');
    process.exit(0);
  }

  console.error('usage: probevane distill <build|stats|train>');
  process.exit(2);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
