import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// probevane serve [dir] [--port N]
//
// Live loop dashboard. Tails <dir>/.probevane/events-*.jsonl (written by the
// event_log rune) and streams new lines to the browser over SSE — watch steps,
// gate blocks, tokens, and edits as the gated loop runs. Zero-dep native http,
// mirrors the cc-remote wrap-the-CLI pattern. Read-only over the event log.
const args = process.argv.slice(2);
const DIR = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const EVENTS = join(DIR, '.probevane');
const PORT = Number(flag('--port') ?? process.env.PROBEVANE_SERVE_PORT ?? 7655);

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// Byte-offset tailer: return new bytes appended to each events-*.jsonl since last seen.
const offsets = new Map<string, number>();
export async function pollNew(dir: string): Promise<string[]> {
  const lines: string[] = [];
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^events-.*\.jsonl$/.test(f));
  for (const f of files.sort()) {
    const p = join(dir, f);
    const sz = (await stat(p).catch(() => null))?.size ?? 0;
    const from = offsets.get(p) ?? 0;
    if (sz <= from) {
      offsets.set(p, sz);
      continue;
    }
    const buf = await readFile(p, 'utf8').catch(() => '');
    offsets.set(p, buf.length);
    for (const ln of buf.slice(from).split('\n').filter(Boolean)) lines.push(ln);
  }
  return lines;
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
      for (const ln of lines) res.write(`data: ${ln}\n\n`);
      await new Promise((r) => setTimeout(r, 500));
    }
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(DASHBOARD);
});

server.listen(PORT, '127.0.0.1', () => console.log(`probevane loop dashboard → http://127.0.0.1:${PORT}  (watching ${EVENTS})`));

const DASHBOARD = `<!doctype html><meta charset=utf-8><title>probevane loop</title>
<style>
 body{margin:0;font:14px/1.5 ui-monospace,Menlo,monospace;background:#0d1117;color:#e6edf3}
 header{padding:12px 18px;background:#161b22;border-bottom:1px solid #30363d;font-weight:700}
 .runs{display:flex;flex-wrap:wrap;gap:10px;padding:14px 18px}
 .run{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 14px;min-width:240px}
 .run.done{opacity:.6}.run h3{margin:0 0 6px;font-size:13px;color:#58a6ff}
 .k{color:#8b949e}.b{color:#f85149}.g{color:#3fb950}
 .bar{height:5px;background:#30363d;border-radius:3px;margin-top:6px;overflow:hidden}
 .bar>i{display:block;height:100%;background:#58a6ff}
 #log{padding:8px 18px;white-space:pre-wrap;color:#8b949e;font-size:12px;max-height:38vh;overflow:auto;border-top:1px solid #30363d}
</style>
<header>🧪 probevane — live loop</header><div class=runs id=runs></div><div id=log></div>
<script>
 const runs={}, R=document.getElementById('runs'), L=document.getElementById('log');
 function render(){
   R.innerHTML='';
   for(const id of Object.keys(runs).sort()){
     const e=runs[id], done=e.stopReason!=null;
     const d=document.createElement('div'); d.className='run'+(done?' done':'');
     d.innerHTML='<h3>'+id+(done?' · '+(e.accepted?'<span class=g>ACCEPTED</span>':'<span class=b>'+e.stopReason+'</span>'):'')+'</h3>'
       +'<div><span class=k>step</span> '+(e.step??0)+' · <span class=k>tools</span> '+(e.toolCalls??0)
       +' · <span class=k>blocks</span> <span class='+((e.gateBlocks)?'b':'')+'>'+(e.gateBlocks??0)+'</span></div>'
       +'<div><span class=k>tok</span> '+(e.tokensIn??0)+'/'+(e.tokensOut??0)+(e.tool?' · <span class=k>tool</span> '+e.tool:'')+'</div>'
       +(e.gateBlockReasons&&e.gateBlockReasons.length?'<div class=b>'+e.gateBlockReasons.slice(-1)[0]+'</div>':'')
       +'<div class=bar><i style="width:'+Math.min(100,(e.step??0)/30*100)+'%"></i></div>';
     R.appendChild(d);
   }
 }
 const es=new EventSource('/stream');
 es.onmessage=m=>{ try{ const e=JSON.parse(m.data); runs[e.runId]={...runs[e.runId],...e}; render();
   L.textContent+=(e.step!=null?'['+e.runId+' step '+e.step+'] ':'')+(e.tool||e.stopReason||'')+'\\n'; L.scrollTop=L.scrollHeight; }catch{} };
</script>`;
