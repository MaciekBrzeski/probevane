import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sseFrame, tailFrom } from '../loop/observe.js';
import { flag, dirArg } from '../util/args.js';

// probevane serve [dir] [--port N]
//
// Live loop dashboard. Tails <dir>/.probevane/events-*.jsonl (written by the
// event_log rune) and streams new lines to the browser over SSE — watch steps,
// gate blocks, tokens, and edits as the gated loop runs. Zero-dep native http,
// mirrors the cc-remote wrap-the-CLI pattern. Read-only over the event log.
const args = process.argv.slice(2);
const DIR = dirArg(args);
const EVENTS = join(DIR, '.probevane');
const PORT = Number(flag(args, '--port') ?? process.env.PROBEVANE_SERVE_PORT ?? 7655);

const offsets = new Map<string, number>();
// Byte-offset tailer: new lines appended to each events-*.jsonl since last seen.
// The decision (which lines are new) is the pure `tailFrom`; this is just the I/O.
async function pollNew(dir: string): Promise<string[]> {
  const out: string[] = [];
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^events-.*\.jsonl$/.test(f));
  for (const f of files.sort()) {
    const p = join(dir, f);
    if (((await stat(p).catch(() => null))?.size ?? 0) <= (offsets.get(p) ?? 0)) continue;
    const { lines, offset } = tailFrom(await readFile(p, 'utf8').catch(() => ''), offsets.get(p) ?? 0);
    offsets.set(p, offset);
    out.push(...lines);
  }
  return out;
}

const server = createServer(async (req, res) => {
  if ((req.url ?? '/').startsWith('/stream')) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    let alive = true;
    req.on('close', () => (alive = false));
    // backfill everything once, then poll for new lines.
    offsets.clear();
    while (alive) {
      const lines = await pollNew(EVENTS);
      for (const ln of lines) res.write(sseFrame(ln));
      await new Promise((r) => setTimeout(r, 500));
    }
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(DASHBOARD);
});

server.listen(PORT, '127.0.0.1', () => console.log(`probevane loop dashboard → http://127.0.0.1:${PORT}  (watching ${EVENTS})`));

const DASHBOARD = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'loop.html'), 'utf8');
