import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readTraces } from '../distill/collect.js';
import { buildExamples, splitExamples, statsByStack } from '../distill/dataset.js';
import { cpuGenerate, stripFences, baseValue, type BaseResult } from '../distill/bases.js';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { specCandidatesFor } from '../git.js';
import { scoreSuite } from '../loop/passk.js';

// probevane distill <build|stats|train>
//   build   traces → train.jsonl/val.jsonl (quality-filtered, deduped)
//   stats   count + per-stack breakdown of collected traces
//   train   print the LoRA training plan (DRY by default; --execute runs it)
//
// Collect traces first by running the loop with PROBEVANE_TRACES=1.
const OUT = join(homedir(), '.local/share/probevane/distill');

type Traces = Awaited<ReturnType<typeof readTraces>>;
type Adapter = Awaited<ReturnType<typeof selectAdapterOrThrow>>;

function runStats(traces: Traces): void {
  const by = statsByStack(traces);
  console.log(`[distill] ${traces.length} trace(s) collected`);
  for (const [stack, n] of Object.entries(by)) console.log(`  ${stack}: ${n}`);
  if (!traces.length) console.log('  (none yet — run the loop with PROBEVANE_TRACES=1 to collect)');
}

async function runBuild(traces: Traces): Promise<void> {
  const ex = buildExamples(traces);
  const { train, val } = splitExamples(ex);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'train.jsonl'), train.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await writeFile(join(OUT, 'val.jsonl'), val.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log(`[distill] built ${ex.length} example(s) from ${traces.length} trace(s) → ${OUT}/{train,val}.jsonl (${train.length}/${val.length})`);
}

async function runTrain(): Promise<void> {
  const execute = process.argv.includes('--execute');
  // Default to the 3B base — the CPU bake-off winner; lighter to train + serve.
  const base = arg('--base') ?? 'Qwen/Qwen2.5-Coder-3B-Instruct';
  const shared = process.argv.includes('--shared-gpu'); // another job on the GPU
  const flags = shared ? ' --load-4bit --max-vram-frac 0.5 --allow-shared-gpu' : '';
  const cmd = `python scripts/train_lora.py --base ${base} --data ${OUT}/train.jsonl --val ${OUT}/val.jsonl --out ${OUT}/adapter${flags}`;
  console.log('[distill] LoRA training plan (RDNA4 ROCm):');
  console.log(`  base:     ${base}`);
  console.log(`  data:     ${OUT}/train.jsonl`);
  console.log(`  adapter:  ${OUT}/adapter`);
  console.log(`  gpu:      ${shared ? '4-bit QLoRA, capped to 50% VRAM (co-run with another job)' : 'bf16, expects a free GPU (refuses if <8GB free)'}`);
  console.log(`  serve:    vLLM/llama.cpp OpenAI server → probevane generate --model local:<name>`);
  console.log(`  command:  ${cmd}`);
  if (!execute) {
    console.log('\n[distill] DRY RUN — not started (GPU). Re-run with --execute when the GPU is free.');
    return;
  }
  console.error('[distill] --execute requested: launch the command above in the RDNA4 venv (HIP_VISIBLE_DEVICES=0, no HSA_OVERRIDE).');
  process.exit(0);
}

// CPU model bake-off → bake one model in an isolated copy of the fixture.
async function bakeModel(
  model: string,
  fixture: string,
  adapter: Adapter,
  testFile: string,
  prompt: string,
): Promise<BaseResult> {
  const work = join(tmpdir(), `pv-base-${model.replace(/[^a-z0-9]/gi, '_')}`);
  rmSync(work, { recursive: true, force: true });
  cpSync(fixture, work, { recursive: true });
  for (const s of await adapter.specFiles(work)) rmSync(join(work, s), { force: true }); // drop golden tests
  try {
    console.error(`[distill] baking ${model} (CPU)…`);
    const gen = await cpuGenerate(model, 'You write tests. Output ONLY the test file.', prompt);
    writeFileSync(join(work, testFile), stripFences(gen.text));
    const s = await scoreSuite(work, adapter);
    const r = {
      model,
      green: s.green,
      tests: s.tests,
      coverage: s.coverage,
      auditErrors: s.auditErrors,
      ms: gen.ms,
      tokPerSec: gen.tokPerSec,
    };
    return { ...r, value: baseValue(r) };
  } catch (e) {
    console.error(`[distill] ${model} failed: ${String(e).slice(0, 100)}`);
    return { model, green: false, tests: 0, coverage: 0, auditErrors: 0, ms: 0, tokPerSec: 0, value: -1 };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function printBases(results: BaseResult[]): void {
  console.log('\n### probevane distill bases — CPU model bake-off\n');
  console.log('| rank | model | green | tests | cov% | audit err | CPU tok/s | ms | value |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  results.forEach((r, i) => console.log(`| ${i + 1} | ${r.model} | ${r.green ? '✅' : '❌'} | ${r.tests} | ${r.coverage} | ${r.auditErrors} | ${r.tokPerSec} | ${r.ms} | ${r.value} |`));
  const best = results.find((r) => r.value >= 0);
  console.log(best ? `\n**Best CPU base: \`${best.model}\`** (value ${best.value}, ${best.tokPerSec} tok/s). Serve: \`probevane generate --model local:${best.model}\`.` : '\n_No candidate produced a green suite._');
}

async function runBases(): Promise<void> {
  // CPU model bake-off → best base for GPU-less machines.
  const models = (arg('--models') ?? 'qwen2.5-coder:3b,qwen2.5-coder:7b')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fixture = join(process.env.PROBEVANE_ROOT ?? process.cwd(), arg('--fixture') ?? 'fixtures/py-calc');
  const adapter = await selectAdapterOrThrow(fixture);
  const target = (await adapter.discover(fixture, 'unit'))[0];
  if (!target) { console.error('[distill] no target source in fixture'); process.exit(1); }
  const probe = await adapter.probe(fixture, target);
  const src = (await import('node:fs/promises')).readFile(join(fixture, target.sourcePath), 'utf8');
  const testFile = specCandidatesFor(target.sourcePath)[0];
  const prompt = `${probe.digest}\n\nSource ${target.sourcePath}:\n\n${await src}\n\n${adapter.guidance('unit')}\n\nWrite the test at ${testFile}. Use the EXACT identifiers from the source (do not change casing) and import them as shown. Output ONLY the test file code.`;
  console.error(`[distill] bake-off on ${adapter.id} (${fixture}), test → ${testFile}`);
  const results: BaseResult[] = [];
  for (const model of models) results.push(await bakeModel(model, fixture, adapter, testFile, prompt));
  results.sort((a, b) => b.value - a.value || a.ms - b.ms);
  printBases(results);
}

async function main() {
  const sub = process.argv[2] ?? 'stats';
  const traces = await readTraces();

  if (sub === 'stats') return runStats(traces);
  if (sub === 'build') return runBuild(traces);
  if (sub === 'train') return runTrain();
  if (sub === 'bases') return runBases();

  console.error('usage: probevane distill <build|stats|train|bases>');
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
