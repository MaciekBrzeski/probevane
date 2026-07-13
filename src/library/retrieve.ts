import { readIndex, readExample, type IndexRow } from './store.js';

// Few-shot selection. Filter by stack + kind + quality, prefer higher score,
// return the example bodies ready to inline into the generation prompt.
export interface RetrieveQuery {
  stack: string;
  kind: 'unit' | 'e2e';
  category?: string;
  topK?: number;
}

/** A retrieved few-shot example — index metadata plus the markdown body to inline. */
export interface Example {
  meta: IndexRow;
  body: string;
}

// Top-K good examples for stack+kind (category match, then score, then recency), bodies loaded.
export async function retrieveFewShot(q: RetrieveQuery): Promise<Example[]> {
  const topK = q.topK ?? 3;
  const index = await readIndex().catch(() => [] as IndexRow[]);
  const good = index.filter((r) => r.quality === 'good' && r.stack === q.stack && r.kind === q.kind);
  good.sort((a, b) => {
    // category match first, then higher score, then most recent
    const ca = q.category && a.category === q.category ? 1 : 0;
    const cb = q.category && b.category === q.category ? 1 : 0;
    if (ca !== cb) return cb - ca;
    if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
    return b.savedAt.localeCompare(a.savedAt);
  });
  const picked = good.slice(0, topK);
  const out: Example[] = [];
  for (const meta of picked) {
    const body = await readExample(meta.path);
    if (body) out.push({ meta, body });
  }
  return out;
}
