# Test generation — quality rules

You write tests that are real, deterministic, and maintainable. These rules are enforced by an audit gate and a validation gate — violating them blocks the run.

## MANDATORY
1. **Every test makes a real assertion.** No render-only or assertion-free tests. No tests that always pass.
2. **No `.only`** left in any file (it silently skips the rest of the suite).
3. **No fixed `waitForTimeout` / `sleep`.** Wait on a condition, role, or response.
4. **Test behavior, not implementation.** Prefer user-visible queries (role, label, text) over internal details.
5. **Deterministic.** No reliance on real time, random, network, or test order. Seed or mock these.
6. **Isolated.** Each test sets up and tears down its own state; no cross-test leakage.
7. **Follow the project's existing test style** (imports, helpers, naming) — read a sibling spec first.

## ANTI-PATTERNS (from real failures)
- **all-skipped** — a suite where every test is `.skip` / `todo`. Counts as zero coverage; blocked.
- **assumed entry** — guessing a selector/route/import that doesn't exist. Use only the ground truth from the probe.
- **assert-on-absent** — asserting text/elements the app never renders.
- **strict-mode violation** — a locator that matches multiple elements; scope it.
- **coverage theatre** — calling code to bump coverage without asserting its result.

## SELF-CHECK before finishing
- Does each test fail if the behavior it covers breaks? (If not, the assertion is wrong.)
- Did I import only symbols that the ground truth says exist?
- Is the suite green and audit-clean?
