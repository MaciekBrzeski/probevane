import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pickBetter, readModelPointer, writeModelPointer, type EvalResult } from '../distill/improve.js';
import { flag } from './args.js';

// probevane improve-cycle [--promote <model>] [--compare <a.json> <b.json>] [--status]
//
// Close the self-improvement loop ($0 decision half): promote a model as the
// loop's default (writes <state>/model.json, which generate reads), or compare two
// eval results and promote the better. LoRA training stays `distill train
// --execute` (GPU); this auto-measures/auto-promotes among available models.

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    const cur = await readModelPointer();
    console.log(`[probevane] promoted default model: ${cur ?? '(none — uses config/flag/auto)'}`);
    return;
  }

  const promote = flag(args, '--promote');
  if (promote) {
    await writeModelPointer(promote, 'manual --promote');
    console.log(`[probevane] promoted "${promote}" as the default model pointer.`);
    return;
  }

  const ci = args.indexOf('--compare');
  if (ci >= 0) {
    const [aPath, bPath] = [args[ci + 1], args[ci + 2]];
    if (!aPath || !bPath) {
      console.error('usage: probevane improve-cycle --compare <a.json> <b.json>');
      process.exit(2);
    }
    const a = JSON.parse(await readFile(resolve(aPath), 'utf8')) as EvalResult;
    const b = JSON.parse(await readFile(resolve(bPath), 'utf8')) as EvalResult;
    const winner = pickBetter(a, b);
    await writeModelPointer(winner.model, `compare: ${a.model}(${a.acceptRate}) vs ${b.model}(${b.acceptRate})`);
    console.log(`[probevane] winner: ${winner.model} (acceptRate ${winner.acceptRate}) → promoted.`);
    return;
  }

  console.error('usage: probevane improve-cycle [--promote <model>] [--compare <a.json> <b.json>] [--status]');
  process.exit(2);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
