import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { newSpecs } from './validation_gate.js';

// a11y_gate — opt-in (--a11y). A spec that renders/mounts a component must make
// an ACCESSIBILITY assertion: a jest-axe check (toHaveNoViolations) or
// accessible-name queries (getByRole / getByLabel). Pushes generated component
// tests to cover accessibility, not just behavior.
const RENDERS = /\b(render|mount)\s*\(/;
const A11Y = /toHaveNoViolations|\baxe\s*\(|getByRole|getByLabelText|getByLabel\b|findByRole/;

/** Single shared rune instance — stateless, so one const serves every profile. */
export const a11yGate: Rune = {
  name: 'a11y_gate',

  /** The a11y rule, stated up front so specs are written with it in mind. */
  systemPromptAddition(): string {
    return 'ACCESSIBILITY: any test that renders a component must assert accessibility — either `expect(await axe(container)).toHaveNoViolations()` (jest-axe) or query by role/label (getByRole / getByLabelText). A component test with no a11y assertion is rejected.';
  },

  /** Block finishing while any new component-rendering spec lacks an a11y assertion. */
  async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
    for (const rel of newSpecs(ctx)) {
      const src = await readFile(join(ctx.workdir, rel), 'utf8').catch(() => '');
      if (!src || !RENDERS.test(src)) continue; // not a component-rendering spec
      if (!A11Y.test(src)) {
        return block(
          `a11y_gate: ${rel} renders a component but makes no a11y assertion`,
          `${rel} renders a component without any accessibility assertion. Add a jest-axe check (toHaveNoViolations) or query by role/label, then finish.`,
        );
      }
    }
    return ALLOW;
  },
};
