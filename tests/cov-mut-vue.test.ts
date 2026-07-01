import { describe, it, expect } from 'vitest';

import { vueAdapter } from '../src/adapters/vue-vitest-playwright/index.js';

// =========================================================================
// MUTANT — vue-vitest-playwright/index.ts:39
//   `return kind === 'unit' ? <unit guidance> : <e2e guidance>`  (=== → !==)
// The existing cov-mut-adapters test only pins the vue DETECT score; guidance()
// branch-by-kind is unasserted. With `!==` the two kinds swap their guidance.
// =========================================================================
describe('vueAdapter.guidance — branch by kind (kills === → !==)', () => {
  it('unit kind returns the vitest/@vue/test-utils guidance', () => {
    const g = vueAdapter.guidance('unit');
    expect(g).toContain('@vue/test-utils');
    expect(g).not.toContain('@playwright/test'); // e2e string leaks in on a swapped branch
  });

  it('e2e kind returns the Playwright guidance', () => {
    const g = vueAdapter.guidance('e2e');
    expect(g).toContain('@playwright/test');
    expect(g).not.toContain('@vue/test-utils'); // unit string leaks in on a swapped branch
  });
});

// =========================================================================
// MUTANT — vue-vitest-playwright/index.ts:45
//   `return loadPrompt(kind === 'unit' ? 'vue-unit-patterns.md' : 'vue-e2e-patterns.md')`
//   (=== → !==)
// With `!==` the file names swap: unit loads the e2e patterns and vice versa.
// The two docs have distinct headers/tooling markers, so assert on content.
// =========================================================================
describe('vueAdapter.patternsDoc — loads the doc matching kind (kills === → !==)', () => {
  it('unit loads vue-unit-patterns.md (vitest + @vue/test-utils)', async () => {
    const doc = await vueAdapter.patternsDoc('unit');
    expect(doc).toContain('# Unit patterns — vitest + @vue/test-utils');
    expect(doc).not.toContain('# E2E patterns'); // e2e doc header on a swapped branch
  });

  it('e2e loads vue-e2e-patterns.md (Playwright)', async () => {
    const doc = await vueAdapter.patternsDoc('e2e');
    expect(doc).toContain('# E2E patterns — Playwright (Vue app)');
    expect(doc).not.toContain('# Unit patterns'); // unit doc header on a swapped branch
  });
});
