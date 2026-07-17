// Euphony — a playful, phonetic reading of identifiers. With no pronunciation
// dictionary we approximate English prosody: RHYME is the shared "rime" (the last
// vowel cluster + trailing consonants) of two names' head word; METER is the
// syllable count. `euphony_gate` uses this to nudge naming and score a module's
// music. Deliberately heuristic — a tie-breaker for names, never a correctness rule.

const VOWELS = /[aeiouy]+/g;

/** Split an identifier into lowercase words (camelCase / snake_case / kebab-case). */
export function splitWords(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Approximate a word's syllables: count vowel groups (min 1), trailing silent-e dropped. */
export function syllables(word: string): number {
  const groups = word.replace(/e$/, '').match(VOWELS);
  return Math.max(1, groups ? groups.length : 1);
}

/** A word's rhyming tail ("rime"): its last vowel cluster to the end, silent-e folded
 *  in. "parse"→"ars", "sparse"→"ars" (rhyme); "render"/"gender"→"er"; "detect"→"ect". */
export function rime(word: string): string {
  const w = word.replace(/e$/, '');
  const matches = [...w.matchAll(VOWELS)];
  if (!matches.length) return w; // no vowel — the whole (usually tiny) word
  return w.slice(matches[matches.length - 1].index);
}

/** An identifier's rhyme key — the rime of its final (head) word. */
export function rhymeKey(id: string): string {
  const words = splitWords(id);
  return words.length ? rime(words[words.length - 1]) : '';
}

/** Two identifiers rhyme if their head words share a non-trivial rime but aren't equal. */
export function rhymes(a: string, b: string): boolean {
  const key = rhymeKey(a);
  return key.length >= 2 && key === rhymeKey(b) && a !== b;
}

/** An identifier's "meter" — its total syllable count across words. */
export function meter(id: string): number {
  return splitWords(id).reduce((n, w) => n + syllables(w), 0);
}

/** One group of identifiers that rhyme (share a rime), size ≥ 2. */
export interface RhymeFamily { rime: string; names: string[] }

/** A euphony reading of a set of identifiers. */
export interface EuphonyReport {
  count: number;
  families: RhymeFamily[]; // rhyming groups, largest first
  rhymingNames: number; // how many names belong to some family
  density: number; // rhymingNames / count (0..1) — how much of the set rhymes
  meterMean: number;
  meterStdev: number; // spread of meter — lower = more rhythmically regular
  score: number; // 0..100 euphony (rhyme density + rhythmic regularity)
}

/** Group identifiers into rhyme families (shared rime, ≥2 members), largest first. */
export function rhymeFamilies(names: string[]): RhymeFamily[] {
  const byRime = new Map<string, string[]>();
  for (const n of names) {
    const key = rhymeKey(n);
    if (key.length < 2) continue;
    (byRime.get(key) ?? byRime.set(key, []).get(key)!).push(n);
  }
  return [...byRime.entries()]
    .filter(([, ns]) => ns.length >= 2)
    .map(([rimeKey_, ns]) => ({ rime: rimeKey_, names: ns }))
    .sort((a, b) => b.names.length - a.names.length);
}

/** Score a set of identifiers for rhyme density + rhythmic regularity (0..100). */
export function analyzeNames(names: string[]): EuphonyReport {
  const count = names.length;
  if (!count) return { count: 0, families: [], rhymingNames: 0, density: 0, meterMean: 0, meterStdev: 0, score: 0 };
  const families = rhymeFamilies(names);
  const rhymingNames = families.reduce((n, f) => n + f.names.length, 0);
  const density = rhymingNames / count;
  const meters = names.map(meter);
  const meterMean = meters.reduce((a, b) => a + b, 0) / count;
  const meterStdev = Math.sqrt(meters.reduce((a, m) => a + (m - meterMean) ** 2, 0) / count);
  const regularity = Math.max(0, 1 - meterStdev / 2); // stdev 0 → 1, ≥2 syllables → 0
  const score = Math.round(density * 70 + regularity * 30);
  return { count, families, rhymingNames, density, meterMean, meterStdev, score };
}
