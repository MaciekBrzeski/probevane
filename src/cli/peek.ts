import { resolve, join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { parseEvents, type LoopEvent } from '../loop/events.js';
import { latestPerRun, runStatus } from '../loop/observe.js';

// probevane peek [dir]
//   Terminal live view of the loop — reads the same .probevane/events-*.jsonl as
//   `serve`, collapses to the latest event per run, and reprints a compact table
//   every 500ms. Ctrl-C to stop.
const DIR = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.');
const EVENTS = join(DIR, '.probevane');

/** Parse every events-*.jsonl under <dir>/.probevane into one event list. */
async function readAll(): Promise<LoopEvent[]> {
  const files = (await readdir(EVENTS).catch(() => [])).filter((f) => /^events-.*\.jsonl$/.test(f));
  const all: LoopEvent[] = [];
  for (const f of files) all.push(...parseEvents(await readFile(join(EVENTS, f), 'utf8').catch(() => '')));
  return all;
}

/** One compact status row per run (latest event wins), under a fixed header. */
function render(runs: Map<string, LoopEvent>): string {
  const rows = [...runs.values()].sort((a, b) => a.runId.localeCompare(b.runId)).map((e) => {
    return ` ${e.runId.padEnd(16)} ${runStatus(e).padEnd(16)} tools=${e.toolCalls} blocks=${e.gateBlocks} tok=${e.tokensIn}/${e.tokensOut}${e.tool ? ' · ' + e.tool : ''}`;
  });
  return `probevane peek — ${EVENTS}\n${'─'.repeat(72)}\n${rows.join('\n') || ' (no runs yet — start one with PROBEVANE_EVENTS on)'}\n`;
}

// Entry: clear + repaint the table every 500ms — watch(1) over the event log.
async function main() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const out = render(latestPerRun(await readAll()));
    process.stdout.write('\x1b[2J\x1b[H' + out); // clear + home
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (!process.env.VITEST) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
