import { slug } from './report.js';

// GitHub Actions matrix emitter (Slice 5) — the cheapest real distribution
// substrate beyond local-concurrent: emit the `strategy.matrix` a reusable
// workflow fans the fleet out on (one runner per repo). Pure: the daemon-queue /
// docker-queue substrates are the heavier next step.

export interface Matrix {
  include: { repo: string; slug: string }[];
}

/** Build a GH Actions matrix from a repo list (dedup, stable slug per repo). */
export function buildMatrix(repos: string[]): Matrix {
  const seen = new Set<string>();
  const include: Matrix['include'] = [];
  for (const repo of repos) {
    const r = repo.trim();
    if (!r || seen.has(r)) continue;
    seen.add(r);
    include.push({ repo: r, slug: slug(r) });
  }
  return { include };
}
