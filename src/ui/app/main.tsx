// Control-center entry: mounts the static shell components into #app, then
// ports the original inline script (fetch/SSE polling, tab switching, drawer,
// markdown+mermaid rendering, run filtering) as plain module functions.
// Component tags resolve by convention (see scripts/build-ui.mjs) — no imports.
import { mount } from '../runtime.ts';
import { $, j, esc, dirOf, type ProjectInfo, type RunRecord } from './lib.ts';
import { loadConsole } from './console.tsx';

// CDN globals (loaded by shell.html script tags before this bundle runs).
declare const marked: { parse(md: string, opts?: Record<string, unknown>): string };
declare const mermaid: {
  initialize(o: Record<string, unknown>): void;
  render(id: string, src: string): Promise<{ svg: string }>;
};

mount(
  document.getElementById('app')!,
  <>
    <Header />
    <Tabs />
    <ProjectsPanel />
    <RunsPanel />
    <WikiPanel />
    <LaunchPanel />
    <CostPanel />
    <QualityPanel />
    <ConsolePanel />
    <Drawer />
  </>,
);

try { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' }); } catch {}

// --- tabs ---
$('tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button[data-go]') as HTMLElement | null;
  if (!b) return;
  const go = b.dataset.go;
  document.querySelectorAll('nav.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('section[data-tab]').forEach((s) => s.classList.toggle('active', (s as HTMLElement).dataset.tab === go));
  if (go === 'projects') loadProjects();
  if (go === 'runs') loadRuns();
  if (go === 'docs') loadWiki();
});

// --- drawer ---
const drawer = $('drawer');
function openDrawer(title: string) { $('drawerTitle').textContent = title; $('drawerBody').textContent = ''; drawer.classList.add('open'); }
$('drawerClose').onclick = () => drawer.classList.remove('open');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer.classList.remove('open'); });
let followES: EventSource | null = null;
function stopFollow() { if (followES) { followES.close(); followES = null; } }

// --- Projects ---
async function loadProjects() {
  try {
    const { projects } = await j('/projects');
    const box = $('projects'); box.textContent = '';
    if (!projects.length) { box.appendChild(<span class="muted">{'no projects yet — run `probevane spec <dir> --wiki`'}</span>); return; }
    for (const p of projects) box.appendChild(<ProjectCard p={p} onOpen={openProject} />);
  } catch { $('projects').textContent = 'failed to load projects'; }
}
async function openProject(p: ProjectInfo) {
  openDrawer('project — ' + p.name);
  const body = $('drawerBody');
  const md = await fetch('/wiki/raw/' + encodeURIComponent(p.slug) + '.md').then((r) => r.ok ? r.text() : null).catch(() => null);
  if (md === null) { body.appendChild(<span class="muted">{'no wiki page — run `probevane spec <dir> --wiki`'}</span>); return; }
  await renderMarkdown(body, md);
  body.appendChild(<hr />);
  body.appendChild(
    <a href="#" style="color:var(--acc)" onClick={(e: Event) => { e.preventDefault(); drawer.classList.remove('open'); switchTab('runs'); filterRuns(p.name); }}>
      {'filter runs for ' + p.name}
    </a>,
  );
}

// --- Docs (wiki folded in) ---
async function loadWiki() {
  try {
    const { core, projects } = await j('/wiki');
    const list = $('wikiList'); list.textContent = ''; list.classList.remove('muted');
    const group = (title: string, files: string[]) => {
      if (!files.length) return;
      list.appendChild(<div class="muted">{title}</div>);
      for (const f of files) {
        list.appendChild(
          <div style="cursor:pointer;padding:2px 0;color:var(--acc)" onClick={() => openDoc(f)}>
            {f.replace(/\.md$/, '').replace(/^project-/, '· ')}
          </div>,
        );
      }
    };
    group('probevane', core); group('projects', projects);
  } catch { $('wikiList').textContent = 'failed to load wiki'; }
}
async function openDoc(file: string) {
  $('docTitle').textContent = file.replace(/\.md$/, '');
  const body = $('docBody'); body.classList.remove('muted'); body.textContent = 'loading…';
  const md = await fetch('/wiki/raw/' + encodeURIComponent(file)).then((r) => r.ok ? r.text() : null).catch(() => null);
  body.textContent = '';
  if (md === null) { body.appendChild(<span class="muted">not found</span>); return; }
  await renderMarkdown(body, md);
}
// marked runs on TRUSTED docs/wiki files only. Mermaid fences → rendered diagrams.
async function renderMarkdown(container: HTMLElement, md: string) {
  const html = marked.parse(md, { mangle: false, headerIds: false });
  const wrap = (<div class="md"></div>) as HTMLElement;
  wrap.innerHTML = html; container.appendChild(wrap);
  const blocks = [...wrap.querySelectorAll('code.language-mermaid, code.lang-mermaid')];
  let i = 0;
  for (const b of blocks) {
    try {
      const { svg } = await mermaid.render('mmd' + (i++) + '_' + Date.now(), b.textContent ?? '');
      const d = (<div></div>) as HTMLElement;
      d.innerHTML = svg; b.closest('pre')!.replaceWith(d);
    } catch {}
  }
}

// --- Runs ---
let RUN_FILTER = '';
function filterRuns(name: string) { RUN_FILTER = name || ''; loadRuns(); }
async function loadRuns() {
  try {
    const { jobs } = await j('/jobs');
    const active = jobs.filter((jb: { status: string }) => jb.status === 'running');
    const ar = $('activeRuns');
    if (!active.length) { ar.textContent = 'no active runs'; ar.className = 'muted'; }
    else {
      ar.className = ''; ar.textContent = '';
      for (const jb of active) {
        ar.appendChild(
          <div>
            <span class="tag running">running</span>
            {' ' + jb.op + ' · ' + String(jb.dir).split('/').pop()}
            <button class="ghost" style="margin-left:8px" onClick={() => openRunLive(jb.dir)}>watch</button>
          </div>,
        );
      }
    }
  } catch {}
  try {
    let { total, runs } = await j('/runs?limit=100');
    if (RUN_FILTER) runs = runs.filter((r: RunRecord) => (r.label || '').includes(RUN_FILTER));
    $('runsMeta').textContent = RUN_FILTER ? `filtered by "${RUN_FILTER}" (${runs.length}/${total})` : `${total} total`;
    const tb = (<tbody></tbody>) as HTMLElement;
    if (!runs.length) tb.appendChild(<tr><td class="muted" colSpan={6}>none</td></tr>);
    for (const r of runs) tb.appendChild(<RunRow r={r} onOpen={openRun} />);
    $('runs').querySelector('tbody')!.replaceWith(tb);
  } catch {}
}
async function openRun(r: RunRecord) {
  stopFollow();
  openDrawer('run — ' + (r.label || r.runId));
  const body = $('drawerBody');
  const dir = dirOf(r.label);
  body.appendChild(<div class="muted">{`${r.runId} · ${r.model || ''} · ${r.accepted ? 'accepted' : r.stopReason} · $${r.cost ?? 0} · ${r.steps ?? '?'} steps`}</div>);
  try {
    const detail = await j('/run?dir=' + encodeURIComponent(dir) + '&runId=' + encodeURIComponent(r.runId));
    if (detail.events && detail.events.timeline && detail.events.timeline.length) {
      body.appendChild(
        <details>
          <summary>{`timeline · ${detail.events.steps} steps · ${detail.events.gateBlocks} gate blocks`}</summary>
          <pre>{detail.events.timeline.map((t: { step: number; tool?: string; gateBlocks: number; editedFiles?: string[] }) => `step ${t.step}  ${t.tool || ''}  blocks=${t.gateBlocks}${t.editedFiles ? '  edited ' + t.editedFiles.join(',') : ''}`).join('\n')}</pre>
        </details>,
      );
    }
  } catch {}
  body.appendChild(<h3>transcript</h3>);
  const tbox = (<div></div>) as HTMLElement;
  body.appendChild(tbox);
  try {
    const { turns } = await j('/transcript?dir=' + encodeURIComponent(dir) + '&runId=' + encodeURIComponent(r.runId));
    if (!turns.length) tbox.appendChild(<span class="muted">no transcript captured (PROBEVANE_TRANSCRIPT=0?)</span>);
    for (const t of turns) tbox.appendChild(<Turn t={t} />);
  } catch { tbox.appendChild(<span class="muted">transcript unavailable</span>); }
}
// Live watch: stream events into a pre + follow the transcript as turns append.
async function openRunLive(dir: string) {
  stopFollow();
  openDrawer('live — ' + String(dir).split('/').pop());
  const body = $('drawerBody');
  const pre = (<pre></pre>) as HTMLElement;
  pre.textContent = ''; body.appendChild(<h3>events</h3>); body.appendChild(pre);
  body.appendChild(<h3>transcript (live)</h3>);
  const tbox = (<div></div>) as HTMLElement;
  body.appendChild(tbox);
  const es = new EventSource('/stream?dir=' + encodeURIComponent(dir));
  es.onmessage = (ev) => { try { const e = JSON.parse(ev.data); pre.textContent += (e.delta !== undefined ? e.delta : `[step ${e.step ?? '?'}] ${e.tool ?? e.stopReason ?? ''}\n`); pre.scrollTop = pre.scrollHeight; } catch {} };
  drawer.addEventListener('transitionend', () => { if (!drawer.classList.contains('open')) es.close(); }, { once: true });
  // Follow the newest transcript for this dir. runId unknown up front → the stream
  // events carry it; grab the first runId then follow that transcript file.
  const once = (ev: MessageEvent) => { try { const e = JSON.parse(ev.data); if (e.runId) { es.removeEventListener('message', once); followTranscript(dir, e.runId, tbox); } } catch {} };
  es.addEventListener('message', once);
}
function followTranscript(dir: string, runId: string, tbox: HTMLElement) {
  stopFollow();
  followES = new EventSource('/transcript?dir=' + encodeURIComponent(dir) + '&runId=' + encodeURIComponent(runId) + '&follow=1');
  followES.onmessage = (ev) => { try { tbox.appendChild(<Turn t={JSON.parse(ev.data)} />); } catch {} };
}

function switchTab(go: string) { (document.querySelector(`nav.tabs button[data-go="${go}"]`) as HTMLElement).click(); }


// --- header + cost/alerts/audit polling (kept) ---
async function loadOps() { try { const { ops } = await j('/ops'); $('op').innerHTML = ops.map((o: string) => `<option>${esc(o)}</option>`).join(''); } catch {} }

// Set a headline stat; when the value CHANGED, replay the .bump pop so the eye
// lands on what moved. (Class removal + reflow restarts the CSS animation.)
function setStat(id: string, text: string) {
  const n = $(id);
  if (n.textContent === text) return;
  n.textContent = text;
  n.classList.remove('bump');
  void (n as HTMLElement).offsetWidth; // reflow → animation restart
  n.classList.add('bump');
}

async function poll() {
  try {
    const hlth = await j('/health');
    $('health').textContent = `v${hlth.version} · ${hlth.ledgers} ledger(s) · up ${hlth.uptimeSec}s`;
    $('health').classList.remove('connecting');
    $('healthDot').style.background = 'var(--ok)'; $('healthDot').classList.add('live');
  } catch {
    $('health').textContent = 'daemon down'; $('health').classList.remove('connecting');
    $('healthDot').style.background = 'var(--err)'; $('healthDot').classList.remove('live');
  }
  try {
    const a = await j('/aggregate'); const max = Math.max(1, ...a.daily.map((d: { cost: number }) => d.cost));
    $('bars').innerHTML = a.daily.map((d: { date: string; cost: number; accepted: number; runs: number; errors: number }) => `<div class="bar" title="${esc(d.date)}: $${esc(d.cost)} · ${esc(d.accepted)}/${esc(d.runs)} · ${esc(d.errors)} err" style="height:${Math.round((d.cost / max) * 100)}%"></div>`).join('');
    $('aggMeta').textContent = `${a.totals.runs} runs · $${a.totals.totalCost} · accept ${(a.totals.acceptRate * 100).toFixed(0)}%`;
    setStat('cost', '$' + a.totals.totalCost); setStat('accept', (a.totals.acceptRate * 100).toFixed(0) + '%');
  } catch {}
  try { const { alerts } = await j('/alerts'); setStat('alertN', String(alerts.length));
    $('alerts').innerHTML = alerts.length ? alerts.map((a: { severity: string; kind: string; message: string }) => `<div class="alert ${esc(a.severity)}"><b>${esc(a.kind)}</b> — ${esc(a.message)}</div>`).join('') : '<span class="muted">none</span>';
  } catch {}
  try { const { entries } = await j('/audit'); $('audit').textContent = entries.slice(-30).reverse().map((e: { ts: string; action: string; target: string }) => `${e.ts.slice(0, 19)}  ${e.action}  ${e.target}`).join('\n') || 'no library mutations yet'; } catch {}
}

$('run').onclick = async () => {
  const dir = ($('dir') as HTMLInputElement).value.trim(); const op = ($('op') as HTMLSelectElement).value;
  const flags = ($('flags') as HTMLInputElement).value.trim().split(/\s+/).filter(Boolean);
  if (!dir) { $('runMsg').textContent = 'enter a dir'; return; }
  $('runMsg').textContent = 'launching…';
  try {
    const r = await j('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, dir, flags }) });
    if (r.error) { $('runMsg').textContent = '✗ ' + r.error; return; }
    $('runMsg').textContent = `▶ job ${r.id} (${op})`;
    switchTab('runs'); openRunLive(dir); poll();
  } catch (e) { $('runMsg').textContent = '✗ ' + String(e); }
};
$('qbtn').onclick = async () => {
  const dir = ($('qdir') as HTMLInputElement).value.trim(); if (!dir) { $('quality').textContent = 'enter a dir'; return; }
  $('quality').textContent = 'scanning…'; $('quality').classList.remove('muted');
  try {
    const q = await j('/quality?dir=' + encodeURIComponent(dir));
    $('qmeta').textContent = `grade ${q.score}/100 · ${q.errors} err · ${q.warns} warn · ${q.files.length} files · ${q.functions} fns · ${q.duplication.length} dup`;
    $('quality').textContent = q.violations.length ? q.violations.slice(0, 200).map((v: { file: string; line: number; severity: string; rule: string; message: string }) => `${v.file}:${v.line}  ${v.severity.toUpperCase()}  [${v.rule}] ${v.message}`).join('\n') : 'clean — no violations';
  } catch (e) { $('quality').textContent = '✗ ' + String(e); }
};

loadOps(); loadProjects(); loadConsole(); poll(); setInterval(poll, 4000);
