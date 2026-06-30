// Embedding client for semantic search. Defaults to a local ollama embedding
// endpoint ($0); set PROBEVANE_EMBED_URL to an OpenAI-compatible `/v1/embeddings`
// (+ PROBEVANE_API_KEY) to use a hosted model instead. Model via
// PROBEVANE_EMBED_MODEL (default nomic-embed-text).

const EMBED_URL = process.env.PROBEVANE_EMBED_URL ?? 'http://localhost:11434/api/embeddings';
const EMBED_MODEL = process.env.PROBEVANE_EMBED_MODEL ?? 'nomic-embed-text';

/** True for an OpenAI-style endpoint (`/v1/embeddings`), false for ollama-native (`/api/embeddings`). */
function isOpenAiEndpoint(url: string): boolean {
  return url.includes('/v1/');
}

/** Embed one text into a vector via the configured endpoint. */
export async function embedText(text: string, fetchImpl: typeof fetch = fetch): Promise<number[]> {
  const openai = isOpenAiEndpoint(EMBED_URL);
  const body = openai ? { model: EMBED_MODEL, input: text } : { model: EMBED_MODEL, prompt: text };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.PROBEVANE_API_KEY) headers.authorization = `Bearer ${process.env.PROBEVANE_API_KEY}`;
  const res = await fetchImpl(EMBED_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`embed ${res.status} ${await res.text().catch(() => '')} (is the embed endpoint up? ${EMBED_URL})`);
  const j = (await res.json()) as { embedding?: number[]; data?: { embedding: number[] }[] };
  const vec = openai ? j.data?.[0]?.embedding : j.embedding;
  if (!vec) throw new Error('embed: no vector in response');
  return vec;
}

export const embedModel = (): string => EMBED_MODEL;

/** Cosine similarity of two equal-length vectors (0 when either is zero). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
