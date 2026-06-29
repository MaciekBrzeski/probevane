import type { StackAdapter } from './adapter.js';

// nullAdapter — a no-op StackAdapter for stack-agnostic loop modes (the docs
// loop) that drive the engine WITHOUT running tests or probing a specific stack.
// The engine never calls ctx.adapter itself (only runes do), and the docs runes
// don't touch it; these methods exist only to satisfy the type. They return
// benign empties (never throw) so a stray harvest-rune probe can't crash a run.
export const nullAdapter: StackAdapter = {
  id: 'docs',
  async detect() { return 0; },
  async install() {},
  async discover() { return []; },
  async probe(_dir, target) { return { target, facts: {}, digest: '', ok: true }; },
  async run() { return { passed: 0, failed: 0, skipped: 0, green: true, raw: '' }; },
  async coverage() { return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false }; },
  async specFiles() { return []; },
  guidance() { return ''; },
  async patternsDoc() { return ''; },
  auditRules() { return []; },
  commands() { return { typecheck: 'true', lint: 'true', testUnit: 'true', testE2e: 'true', coverage: 'true' }; },
};
