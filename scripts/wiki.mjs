#!/usr/bin/env node
// Zero-dependency self-served wiki. Serves docs/wiki/*.md rendered to HTML with
// a grouped sidebar. Markdown via marked (CDN); Mermaid code blocks render as
// diagrams (CDN). The server stays dependency-free.
//
//   node scripts/wiki.mjs [port]   →   http://localhost:4173
//
// Nav groups: "probevane" (core docs) and "Projects" (files named project-*.md,
// e.g. published `probevane spec --wiki` pages).

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'wiki');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173);

const PAGE = (nav, file) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>probevane wiki</title>
<style>
 :root{--fg:#1b1f24;--muted:#6a737d;--accent:#2b6cb0;--bg:#fff;--side:#f6f8fa;--border:#e1e4e8}
 @media(prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--bg:#0d1117;--side:#161b22;--border:#30363d}}
 *{box-sizing:border-box}body{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg)}
 .wrap{display:flex;min-height:100vh}
 nav{width:260px;flex:0 0 260px;background:var(--side);border-right:1px solid var(--border);padding:20px;overflow:auto;position:sticky;top:0;height:100vh}
 nav .brand{font-size:15px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 12px;font-weight:700}
 nav .grp{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:18px 0 6px}
 nav a{display:block;padding:5px 8px;border-radius:6px;color:var(--fg);text-decoration:none;font-size:14px}
 nav a:hover{background:var(--border)}nav a.active{background:var(--accent);color:#fff}
 main{flex:1;padding:40px 56px;max-width:920px;overflow:auto}
 main img{max-width:100%}pre{background:var(--side);padding:14px;border-radius:8px;overflow:auto;border:1px solid var(--border)}
 code{background:var(--side);padding:.15em .4em;border-radius:5px;font-size:.9em}pre code{background:none;padding:0}
 /* Diagrams: break out of the prose column, render at natural size, scroll + pan/zoom. */
 pre.mermaid{background:var(--side);border:1px solid var(--border);border-radius:8px;padding:8px;overflow:auto;max-height:82vh;width:calc(100vw - 260px - 112px);max-width:calc(100vw - 260px - 112px);margin-left:calc((920px - (100vw - 260px - 112px))/2)}
 pre.mermaid svg{max-width:none!important;height:auto}
 .diagram-hint{color:var(--muted);font-size:12px;margin:-8px 0 18px}
 table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--border);padding:7px 10px;text-align:left}
 h1,h2,h3{line-height:1.25}h2{border-bottom:1px solid var(--border);padding-bottom:.3em;margin-top:1.8em}
 a{color:var(--accent)}blockquote{border-left:3px solid var(--accent);margin:0;padding:.1em 1em;color:var(--muted)}
</style></head><body><div class="wrap">
<nav><div class="brand">probevane wiki</div>${nav}</nav>
<main id="content">loading…</main></div>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script type="module">
 import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
 const dark = matchMedia('(prefers-color-scheme: dark)').matches;
 mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' });
 const FILE=${JSON.stringify(file)};
 try {
   const md = await (await fetch('/raw/'+FILE)).text();
   const el = document.getElementById('content');
   el.innerHTML = marked.parse(md);
   el.querySelectorAll('a[href$=".md"]').forEach(a =>
     a.setAttribute('href','/'+a.getAttribute('href').replace(/\\.md$/,'')));
   // turn \`\`\`mermaid code blocks into rendered diagrams
   const blocks = [...el.querySelectorAll('code.language-mermaid')];
   blocks.forEach(c => { const p=document.createElement('pre'); p.className='mermaid'; p.textContent=c.textContent; c.closest('pre').replaceWith(p); });
   if (blocks.length) await mermaid.run({ querySelector: 'pre.mermaid' });
 } catch (e) { document.getElementById('content').textContent='error: '+e; }
</script></body></html>`;

async function navHtml(active) {
  const files = (await readdir(ROOT)).filter((f) => f.endsWith('.md'));
  const core = files.filter((f) => !f.startsWith('project-')).sort((a, b) => (a === 'Home.md' ? -1 : b === 'Home.md' ? 1 : a.localeCompare(b)));
  const projects = files.filter((f) => f.startsWith('project-')).sort();

  const link = (f, stripPrefix) => {
    const slug = f.replace(/\.md$/, '');
    let label = slug.replace(/-/g, ' ');
    if (stripPrefix) label = slug.replace(/^project-/, '').replace(/-/g, ' ');
    return `<a href="/${slug}"${slug === active ? ' class="active"' : ''}>${label}</a>`;
  };

  let html = `<div class="grp">probevane</div>` + core.map((f) => link(f, false)).join('');
  if (projects.length) html += `<div class="grp">Projects</div>` + projects.map((f) => link(f, true)).join('');
  return html;
}

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (url.startsWith('/raw/')) {
      const name = normalize(url.slice(5)).replace(/^(\.\.(\/|\\|$))+/, '');
      const file = join(ROOT, extname(name) ? name : name + '.md');
      const body = await readFile(file, 'utf8').catch(() => '# Not found\n');
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      return res.end(body);
    }
    const slug = url === '/' ? 'Home' : url.slice(1);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE(await navHtml(slug), slug));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.listen(PORT, () => console.log(`probevane wiki → http://localhost:${PORT}`));
