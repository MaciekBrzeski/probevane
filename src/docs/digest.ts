import { readdirSync, readFileSync, statSync, existsSync, type Dirent } from 'node:fs';
import { join, extname, relative, basename } from 'node:path';

// Stack-agnostic project digest for the narrative docs loop. Unlike spec/build.ts
// (which is bound to the TS import graph), this works on any language by reading
// the file tree, manifests, entry points, and existing docs — the grounding the
// docs-writer model needs to produce accurate, comprehensive prose.

const SKIP = new Set([
  'node_modules', 'target', 'dist', 'build', 'coverage', '.git', '.probevane',
  'pkg', '.next', '.cache', 'DerivedDataCache', 'Binaries', '__pycache__', '.venv', 'venv',
]);
const LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
  '.rs': 'Rust', '.py': 'Python', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby',
  '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++', '.cs': 'C#', '.swift': 'Swift',
  '.gd': 'GDScript', '.glsl': 'GLSL', '.wgsl': 'WGSL', '.sh': 'Shell',
};
const SOURCE_EXT = new Set(Object.keys(LANG));

interface FileRec { rel: string; loc: number; ext: string }

function readEntries(abs: string): Dirent[] {
  try {
    return readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
}

function fileRec(root: string, p: string, name: string): FileRec {
  const ext = extname(name);
  let loc = 0;
  try { loc = readFileSync(p, 'utf8').split('\n').length; } catch { /* binary/unreadable */ }
  return { rel: relative(root, p), loc, ext };
}

function visitEntry(root: string, abs: string, depth: number, e: Dirent, out: FileRec[]): void {
  if (e.name.startsWith('.') && e.name !== '.github') return;
  const p = join(abs, e.name);
  if (e.isDirectory()) {
    if (!SKIP.has(e.name)) visitDir(root, p, depth + 1, out);
  } else if (e.isFile()) {
    out.push(fileRec(root, p, e.name));
  }
}

function visitDir(root: string, abs: string, depth: number, out: FileRec[]): void {
  if (depth > 8) return;
  for (const e of readEntries(abs)) visitEntry(root, abs, depth, e, out);
}

function walk(root: string): FileRec[] {
  const out: FileRec[] = [];
  visitDir(root, root, 0, out);
  return out;
}

function tree(files: FileRec[], maxEntries = 80): string {
  // A pruned, sorted path listing (dirs implied by paths) — capped.
  const paths = files.map((f) => f.rel).sort();
  const shown = paths.slice(0, maxEntries);
  const extra = paths.length - shown.length;
  return shown.join('\n') + (extra > 0 ? `\n… (+${extra} more files)` : '');
}

function manifests(root: string): string[] {
  const out: string[] = [];
  const read = (name: string) => (existsSync(join(root, name)) ? readFileSync(join(root, name), 'utf8') : null);

  const pkg = read('package.json');
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      const scripts = j.scripts ? Object.entries(j.scripts).map(([k, v]) => `  ${k}: ${v}`).join('\n') : '  (none)';
      const deps = Object.keys({ ...j.dependencies, ...j.devDependencies }).slice(0, 30).join(', ');
      out.push(`package.json: name=${j.name ?? '?'} version=${j.version ?? '?'}\n description: ${j.description ?? '—'}\n scripts:\n${scripts}\n deps: ${deps || '—'}`);
    } catch { out.push('package.json: (unparseable)'); }
  }
  const cargo = read('Cargo.toml');
  if (cargo) {
    const pkgName = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const desc = cargo.match(/^\s*description\s*=\s*"([^"]+)"/m)?.[1];
    const ws = /\[workspace\]/.test(cargo);
    const members = cargo.match(/members\s*=\s*\[([^\]]*)\]/)?.[1]?.replace(/\s+/g, ' ').trim();
    out.push(`Cargo.toml: name=${pkgName ?? '(workspace)'} ${ws ? '[workspace]' : ''}\n description: ${desc ?? '—'}${members ? `\n members: ${members}` : ''}`);
  }
  const py = read('pyproject.toml');
  if (py) {
    const name = py.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    out.push(`pyproject.toml: name=${name ?? '?'}`);
  }
  const gomod = read('go.mod');
  if (gomod) out.push(`go.mod:\n${gomod.split('\n').slice(0, 4).join('\n')}`);
  return out;
}

function existingDocs(root: string, files: FileRec[]): string[] {
  const out: string[] = [];
  const candidates = ['README.md', 'CLAUDE.md', 'RENDER_NOTES.md'];
  for (const c of candidates) {
    const p = join(root, c);
    if (existsSync(p)) {
      const body = readFileSync(p, 'utf8').split('\n').slice(0, 50).join('\n');
      out.push(`--- ${c} (first 50 lines) ---\n${body}`);
    }
  }
  // a couple of docs/*.md
  for (const f of files.filter((f) => /^docs\//.test(f.rel) && f.rel.endsWith('.md')).slice(0, 3)) {
    const body = readFileSync(join(root, f.rel), 'utf8').split('\n').slice(0, 30).join('\n');
    out.push(`--- ${f.rel} (first 30 lines) ---\n${body}`);
  }
  return out;
}

function entryPoints(root: string, files: FileRec[]): string[] {
  const names = new Set(['main.rs', 'lib.rs', 'main.ts', 'main.py', 'index.ts', 'index.js', 'main.go', '__main__.py', 'cli.ts', 'cli.py']);
  const eps = files
    .filter((f) => names.has(basename(f.rel)) || /(^|\/)(bin|cli)\//.test(f.rel))
    .map((f) => f.rel)
    .slice(0, 12);
  return eps;
}

function sampleHeaders(root: string, files: FileRec[]): string[] {
  // The largest source files — their leading lines (doc comments / imports) reveal
  // responsibility. Cap to keep the digest bounded.
  const top = files
    .filter((f) => SOURCE_EXT.has(f.ext) && !/\.(test|spec)\./.test(f.rel))
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 8);
  return top.map((f) => {
    const head = readFileSync(join(root, f.rel), 'utf8').split('\n').slice(0, 25).join('\n');
    return `--- ${f.rel} (${f.loc} lines) ---\n${head}`;
  });
}

/** A bounded, language-agnostic snapshot of a project for the docs-writer model. */
export function buildDocsDigest(dir: string): string {
  const name = basename(dir.replace(/\/$/, ''));
  const files = walk(dir);

  // language breakdown by LOC
  const byLang = new Map<string, { files: number; loc: number }>();
  for (const f of files) {
    const lang = LANG[f.ext];
    if (!lang) continue;
    const cur = byLang.get(lang) ?? { files: 0, loc: 0 };
    cur.files++; cur.loc += f.loc;
    byLang.set(lang, cur);
  }
  const langs = [...byLang.entries()]
    .sort((a, b) => b[1].loc - a[1].loc)
    .map(([l, s]) => `${l} (${s.files} files, ~${s.loc} LOC)`)
    .join(', ');

  const parts: string[] = [];
  parts.push(`# PROJECT DIGEST: ${name}`);
  parts.push(`Path: ${dir}`);
  parts.push(`Total files (excl. deps/build): ${files.length}`);
  parts.push(`Languages: ${langs || '(none detected)'}`);
  parts.push('');
  parts.push('## Manifests');
  parts.push(manifests(dir).join('\n\n') || '(none)');
  parts.push('');
  parts.push('## Entry points');
  parts.push(entryPoints(dir, files).join('\n') || '(none obvious)');
  parts.push('');
  parts.push('## File tree (pruned)');
  parts.push(tree(files));
  parts.push('');
  const docs = existingDocs(dir, files);
  if (docs.length) {
    parts.push('## Existing docs (complement these — do not contradict)');
    parts.push(docs.join('\n\n'));
    parts.push('');
  }
  parts.push('## Largest source files (leading lines)');
  parts.push(sampleHeaders(dir, files).join('\n\n'));
  return parts.join('\n');
}
