import { describe, it, expect } from 'vitest';
import {
  splitWords, syllables, rime, rhymes, meter, rhymeFamilies, analyzeNames,
} from '../src/quality/euphony.js';

describe('euphony — phonetic identifier analysis', () => {
  it('splits camel / snake / kebab identifiers into words', () => {
    expect(splitWords('readCoverageSummary')).toEqual(['read', 'coverage', 'summary']);
    expect(splitWords('null_adapter')).toEqual(['null', 'adapter']);
    expect(splitWords('detect-react')).toEqual(['detect', 'react']);
  });

  it('counts syllables by vowel groups (silent-e dropped)', () => {
    expect(syllables('parse')).toBe(1);
    expect(syllables('render')).toBe(2);
    expect(syllables('coverage')).toBe(3);
  });

  it('computes a rhyming rime from the last vowel cluster', () => {
    expect(rime('parse')).toBe('ars');
    expect(rime('sparse')).toBe('ars');
    expect(rime('render')).toBe('er');
  });

  it('rhymes head words that share a non-trivial rime', () => {
    expect(rhymes('parse', 'sparse')).toBe(true);
    expect(rhymes('render', 'gender')).toBe(true);
    expect(rhymes('detectReact', 'collectReact')).toBe(true); // head word "react"
    expect(rhymes('parse', 'render')).toBe(false);
    expect(rhymes('parse', 'parse')).toBe(false); // identical names don't rhyme
  });

  it('meter is the total syllable count', () => {
    expect(meter('parse')).toBe(1);
    expect(meter('readFile')).toBe(2);
    expect(meter('detectReact')).toBe(3);
  });

  it('groups rhyme families largest first', () => {
    const fams = rhymeFamilies(['detect', 'collect', 'inspect', 'render', 'gender']);
    expect(fams[0].rime).toBe('ect');
    expect(fams[0].names).toEqual(['detect', 'collect', 'inspect']);
  });

  it('scores rhyme density + rhythmic regularity, 0..100', () => {
    const musical = analyzeNames(['detect', 'collect', 'inspect', 'protect']);
    expect(musical.density).toBe(1);
    expect(musical.score).toBe(100); // all rhyme, all 2 syllables → perfect
    const flat = analyzeNames(['alpha', 'beta', 'gamma', 'delta']);
    expect(flat.families).toHaveLength(0);
    expect(flat.score).toBeLessThan(musical.score);
  });

  it('is empty-safe', () => {
    const r = analyzeNames([]);
    expect(r.score).toBe(0);
    expect(r.families).toHaveLength(0);
  });
});
