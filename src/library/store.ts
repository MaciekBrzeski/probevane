import { join } from 'node:path';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { stateRoot } from '../util/state.js';
import { appendJsonl, readJsonl } from '../util/jsonl.js';
import { recordAudit } from '../observe/audit.js';

// Cross-project learning library — mirrors qaforge's ~/.local/share/qa-harness
// layout: an append-only index.jsonl + per-example <kind>/<category>/<slug>.{md,meta.json}.
// A `stack` field keeps React few-shot from leaking into Python (and vice versa).
// PROBEVANE_LIB overrides; else the state root (honors PROBEVANE_STATE isolation).

export const LIB_ROOT = process.env.PROBEVANE_LIB ?? stateRoot();

export interface ExampleMeta {
  slug: string;
  stack: string; // adapter id, e.g. "react-vitest-playwright"
  kind: 'unit' | 'e2e';
  category: string; // e.g. "pure-helpers", "component-crud"
  quality: 'good' | 'bad';
  sourceFile?: string;
  rationale?: string;
  score?: number;
  savedAt: string;
}

export interface IndexRow extends ExampleMeta {
  path: string; // relative to LIB_ROOT
}

function exampleDir(m: ExampleMeta): string {
  return join(m.quality, m.stack, m.category);
}

export async function saveExample(m: ExampleMeta, contents: string): Promise<string> {
  const relDir = exampleDir(m);
  const absDir = join(LIB_ROOT, relDir);
  await mkdir(absDir, { recursive: true });
  const mdRel = join(relDir, `${m.slug}.md`);
  const metaRel = join(relDir, `${m.slug}.meta.json`);
  await writeFile(join(LIB_ROOT, mdRel), contents);
  await writeFile(join(LIB_ROOT, metaRel), JSON.stringify(m, null, 2) + '\n');
  const row: IndexRow = { ...m, path: mdRel };
  await appendJsonl(join(LIB_ROOT, 'index.jsonl'), row);
  await recordAudit({
    action: 'library.save',
    target: m.slug,
    detail: { stack: m.stack, kind: m.kind, category: m.category, quality: m.quality, score: m.score },
  });
  return mdRel;
}

export async function readIndex(): Promise<IndexRow[]> {
  return readJsonl<IndexRow>(join(LIB_ROOT, 'index.jsonl'));
}

export async function readExample(relPath: string): Promise<string> {
  return readFile(join(LIB_ROOT, relPath), 'utf8').catch(() => '');
}

/** True if the library has been initialized (any index rows). */
export async function libraryExists(): Promise<boolean> {
  return readdir(LIB_ROOT)
    .then((e) => e.includes('index.jsonl'))
    .catch(() => false);
}
