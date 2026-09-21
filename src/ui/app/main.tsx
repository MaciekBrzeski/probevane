// Control-center entry: mounts shell components into #app, then ports the old
// inline script (polling, tabs, drawer, markdown/mermaid, filtering) as functions.
import { mount } from '../runtime.ts';
import { loadChecks } from './checks-tab.tsx';
import { loadChat } from './chat-tab.tsx';
import { $, j, esc, applyPalette, type ProjectInfo } from './lib.ts';
import { WaveStrip } from './components/chrome/WaveStrip.tsx';
import { initRuns, loadRuns, openRunLive, filterRuns, switchTab, openDrawer, closeDrawer } from './runs.tsx';
import { loadConsole, consolePipelineEvent, consolePipelineReset, startTheater } from './console.tsx';
import { loadTerminal, terminalActivated } from './terminal.ts';
applyPalette(); // shared palette SSOT → :root custom-props (see src/util/theme.ts)

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
    <WaveStrip />
    <Tabs />
    <ProjectsPanel />
    <RunsPanel />
    <WikiPanel />
    <LaunchPanel />
    <CostPanel />
    <QualityPanel />
    <ChecksPanel />
    <ChatPanel />
    <ConsolePanel />
    <TerminalPanel />
    <Drawer />
  </>,
);

try { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' }); } catch {}

// --- tabs ---
// sliding underline indicator: repositioned on every tab switch (and resize)
const tabInd = (<span class="tabind"></span>) as HTMLElement;
$('tabs').appendChild(tabInd);
function placeTabInd(): void {
  const b = document.querySelector('nav.tabs button.active') as HTMLElement | null;
  if (!b) return;
  tabInd.style.width = b.offsetWidth + 'px';
  tabInd.style.transform = `translateX(${b.offsetLeft}px)`;
}
window.addEventListener('resize', placeTabInd);
queueMicrotask(placeTabInd);
$('tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button[data-go]') as HTMLElement | null;
  if (!b) return;
  const go = b.dataset.go;
  document.querySelectorAll('nav.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('section[data-tab]').forEach((s) => s.classList.toggle('active', (s as HTMLElement).dataset.tab === go));
  placeTabInd();
  if (go === 'projects') loadProjects();
  if (go === 'runs') loadRuns();
  if (go === 'docs') loadWiki();
  if (go === 'checks') loadChecks();
  if (go === 'chat') loadChat();
  if (go === 'terminal') { loadTerminal(); terminalActivated(); }
});

// --- Projects ---
async function loadProjects() {
  try {
    const { projects } = await j('/projects');
    const box = $('projects'); box.textContent = '';
    if (!projects.length) { box.appendChild(<span class="muted">{'no projects yet — run `probevane spec <dir> --wiki`'}</span>); return; }
    projects.forEach((p: ProjectInfo, i: number) => {
      const card = (<ProjectCard p={p} onOpen={openProject} />) as HTMLElement;
      card.style.setProperty('--i', String(i)); // entrance stagger (CSS cardIn)
      box.appendChild(card);
    });
  } catch { $('projects').textContent = 'failed to load projects'; }
}
// Drawer view for a project card: its wiki page plus a link that jumps to the
// runs tab pre-filtered to this project.
async function openProject(p: ProjectInfo) {
  openDrawer('project — ' + p.name);
  const body = $('drawerBody');
  const md = await fetch('/wiki/raw/' + encodeURIComponent(p.slug) + '.md').then((r) => r.ok ? r.text() : null).catch(() => null);
  if (md === null) { body.appendChild(<span class="muted">{'no wiki page — run `probevane spec <dir> --wiki`'}</span>); return; }
  await renderMarkdown(body, md);
  body.appendChild(<hr />);
  body.appendChild(
    <a href="#" style="color:var(--acc)" onClick={(e: Event) => { e.preventDefault(); closeDrawer(); switchTab('runs'); filterRuns(p.name); }}>
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
// Load one wiki page into the docs pane and render it (markdown + mermaid).
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

// innerHTML rewrites restart CSS entrance animations — only touch the DOM
// when the payload actually changed (the 4s poll otherwise replays them).
const LAST: Record<string, string> = {};
// True only when this key's payload differs from the last poll — the guard
// that keeps the 4s poll from replaying entrance animations (see above).
function changed(key: string, payload: unknown): boolean {
  const j2 = JSON.stringify(payload);
  if (LAST[key] === j2) return false;
  LAST[key] = j2;
  return true;
}

// 4s heartbeat: health, cost aggregate, alerts, audit trail. Each fetch fails
// soft so a dead daemon degrades to 'daemon down', not a broken page.
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
    if (changed('bars', a.daily))
      $('bars').innerHTML = a.daily.map((d: { date: string; cost: number; accepted: number; runs: number; errors: number }, i: number) => `<div class="bar" title="${esc(d.date)}: $${esc(d.cost)} · ${esc(d.accepted)}/${esc(d.runs)} · ${esc(d.errors)} err" style="height:${Math.round((d.cost / max) * 100)}%;--i:${i}"></div>`).join('');
    $('aggMeta').textContent = `${a.totals.runs} runs · $${a.totals.totalCost} · accept ${(a.totals.acceptRate * 100).toFixed(0)}%`;
    setStat('cost', '$' + a.totals.totalCost); setStat('accept', (a.totals.acceptRate * 100).toFixed(0) + '%');
  } catch {}
  try { const { alerts } = await j('/alerts'); setStat('alertN', String(alerts.length));
    if (changed('alerts', alerts))
      $('alerts').innerHTML = alerts.length ? alerts.map((a: { severity: string; kind: string; message: string }) => `<div class="alert ${esc(a.severity)}"><b>${esc(a.kind)}</b> — ${esc(a.message)}</div>`).join('') : '<span class="muted">none</span>';
  } catch {}
  try { const { entries } = await j('/audit'); $('audit').textContent = entries.slice(-30).reverse().map((e: { ts: string; action: string; target: string }) => `${e.ts.slice(0, 19)}  ${e.action}  ${e.target}`).join('\n') || 'no library mutations yet'; } catch {}
  // signals-driven runs tab rides the heartbeat: identity-stable snapshots mean
  // an unchanged poll is zero DOM operations, so this is churn-free.
  loadRuns();
}

$('run').onclick = async () => {
  const dir = ($('dir') as HTMLInputElement).value.trim(); const op = ($('op') as HTMLSelectElement).value;
  // Quote-aware: --task "add multiply()" must survive as ONE flag value.
  const flags = (($('flags') as HTMLInputElement).value.match(/"[^"]*"|\S+/g) ?? []).map((f) => f.replace(/^"|"$/g, ''));
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

initRuns(); loadOps(); loadProjects(); loadConsole(); poll(); setInterval(poll, 4000);
