import type { AuditRule } from '../adapters/adapter.js';
import { stripToCode } from '../quality/analyze-detect.js';

// JS/TS audit rules, ported from qaforge/src/cli/audit.ts and extended with
// React-unit-specific rules. The shared engine lives in audit/core.ts (P2);
// these are the language-specific rules the React adapter contributes.
//
// Suppression: a line (or the line above) containing "probevane-allow: <rule-id>"
// silences that rule. Handled in core.ts; rules here just detect.

// Structural rules match on a literal-STRIPPED view of the source (ADR-013's
// stripToCode): a `test('x', …)` inside a fixture string, or a `}` inside a
// quoted value, must not fool the test-case detector / brace matcher. Files
// are scanned line-by-line sequentially, so a one-slot memo strips each file once.
let memoSrc = '';
let memoStripped: string[] = [];
// Stripped view of the current file, recomputed only when the source changes (one-slot memo).
function strippedLines(full: string): string[] {
  if (full !== memoSrc) {
    memoSrc = full;
    memoStripped = stripToCode(full.split('\n'));
  }
  return memoStripped;
}

// Every JS/TS rule the adapters contribute, grouped by concern (hygiene, presence, quality).
export function jsAuditRules(): AuditRule[] {
  return [...importHygieneRules(), ...assertionPresenceRules(), ...assertionQualityRules()];
}

// Import / runner-config hygiene: catch imports and harness toggles that silently
// disable tests (wrong Playwright package, brittle waits, leftover `.only`).
function importHygieneRules(): AuditRule[] {
  return [
    {
      // The Playwright runner package is `@playwright/test`; a bare `playwright/test`
      // import loads zero tests ("No tests found"). Catch it so the loop self-corrects.
      id: 'playwright-test-import',
      severity: 'error',
      check: (line) =>
        /from\s+['"]playwright\/test['"]/.test(line)
          ? `import from '@playwright/test', not 'playwright/test' (the bare import collects 0 tests)`
          : null,
    },
    {
      id: 'no-wait-for-timeout',
      severity: 'error',
      // Stripped view: a waitForTimeout inside a fixture STRING is data, not a call.
      check: (_line, lineNo, _file, full) =>
        (strippedLines(full)[lineNo - 1] ?? '').includes('waitForTimeout')
          ? 'waitForTimeout is brittle — use waitFor / expect.poll / locator waits instead'
          : null,
    },
    {
      id: 'no-only',
      severity: 'error',
      check: (line) =>
        /\b(test|it|describe)\.only\b/.test(line)
          ? '.only left in spec — would silently skip the rest of the suite'
          : null,
    },
  ];
}

// Assertion presence: a test/render/mutation that never asserts is coverage theatre.
function assertionPresenceRules(): AuditRule[] {
  return [
    {
      id: 'render-without-assertion',
      severity: 'warn',
      // A unit test that renders but never asserts is a coverage-gaming smell.
      check: (line, lineNo, _file, full) => {
        if (!/\brender\s*\(/.test(line)) return null;
        const rest = full.split('\n').slice(lineNo, lineNo + 25).join('\n');
        return /\bexpect\s*\(/.test(rest)
          ? null
          : 'render() with no expect() within 25 lines — assertion-free test';
      },
    },
    {
      id: 'missing-status-assert',
      severity: 'error',
      // API mutation in e2e must be followed by a status assertion. Stripped
      // view: `.post(` inside a fixture string is data, not an API call.
      check: (_line, lineNo, _file, full) => {
        const lines = strippedLines(full);
        const line = lines[lineNo - 1] ?? '';
        const mut = line.match(/\.(post|put|patch|delete)\s*\(/);
        if (!mut) return null;
        if (/\.catch\s*\(/.test(line)) return null;
        const window = lines.slice(lineNo, lineNo + 8).join('\n');
        return /expect\s*\(\s*\w+\.status\s*\(\s*\)\s*\)/.test(window)
          ? null
          : `${mut[1].toUpperCase()} call not followed by a status assertion within 8 lines`;
      },
    },
    assertionFreeBlock,
  ];
}

// A test case with no assertion in its body (coverage theatre). Matches and
// brace-counts on the literal-stripped view so `test('x')` inside a fixture
// string (or a `}` inside a quoted value) can't fool it.
const assertionFreeBlock: AuditRule = {
  id: 'assertion-free-block',
  severity: 'error',
  check: (_line, lineNo, _file, full) => {
    const lines = strippedLines(full);
    const sline = lines[lineNo - 1] ?? '';
    const m = sline.match(/\b(it|test)\s*(\.\w+)?\s*\(/);
    if (!m || /\.(skip|todo)\b/.test(sline)) return null;
    // Setup/teardown hooks and config calls are not test cases —
    // `test.beforeAll(...)` legitimately has no assertion.
    if (m[2] && /^\.(beforeAll|afterAll|beforeEach|afterEach|describe|use|step|setTimeout|slow|fixme|fail)$/.test(m[2])) return null;
    const body = blockBody(lines.join('\n'), lineNo);
    return /\bexpect\s*\(|\bassert\b|\.toHaveBeenCalled/.test(body)
      ? null
      : 'test case has no assertion — every test must assert observable behavior';
  },
};

// Assertion quality: assertions that exist but are weak/conditional, plus unused
// imports used to inflate module coverage.
function assertionQualityRules(): AuditRule[] {
  return [
    conditionalExpect,
    {
      id: 'snapshot-only',
      severity: 'warn',
      // A test whose only assertion is a snapshot pins current output without
      // checking it's correct — weak against coverage gaming.
      check: (line, lineNo, _file, full) => {
        const m = line.match(/\b(it|test)\s*(\.\w+)?\s*\(/);
        if (!m) return null;
        const body = blockBody(full, lineNo);
        const snaps = (body.match(/toMatch(Inline)?Snapshot/g) ?? []).length;
        const expects = (body.match(/\bexpect\s*\(/g) ?? []).length;
        return snaps > 0 && expects === snaps
          ? 'test asserts only via snapshot — add at least one explicit value assertion'
          : null;
      },
    },
    {
      id: 'unused-import-in-test',
      severity: 'warn',
      // An imported symbol never used can be a trick to inflate module coverage.
      check: (line, _lineNo, _file, full) => {
        const m = line.match(/^\s*import\s+\x7b([^\x7d]+)\x7d\s+from/);
        if (!m) return null;
        const names = m[1]
          .split(',')
          .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim())
          .filter(Boolean);
        const rest = full.replace(line, '');
        const unused = names.filter((n) => !new RegExp(`\\b${escapeRe(n)}\\b`).test(rest));
        return unused.length ? `unused import(s): ${unused.join(', ')} — remove or use them` : null;
      },
    },
  ];
}

// An assertion guarded by a condition may silently never run — a classic way
// a test "passes" without testing anything.
const conditionalExpect: AuditRule = {
  id: 'conditional-expect',
  severity: 'error',
  check: (line, lineNo, _file, full) => {
    const hit =
      /\bif\s*\([^)]*\)\s*(\x7b)?\s*(await\s+)?expect\s*\(/.test(line) ||
      /[?&|]{1,2}\s*(await\s+)?expect\s*\(/.test(line);
    if (!hit) return null;
    // TypeScript narrowing exemption: `if (x.kind === 'block') expect(x.reason)…`
    // (or `if (!r.ok) expect(r.error)…`) is guaranteed to run when a nearby
    // PRECEDING line unconditionally asserts the same guard expression —
    // expect(x.kind)… / expect(r.ok)… . The if exists for the type checker,
    // not for control flow.
    const guard = line.match(/\bif\s*\(\s*!?\s*([\w.$]+)\s*(?:[!=]==?|\))/)?.[1];
    if (guard) {
      const before = full.split('\n').slice(Math.max(0, lineNo - 4), lineNo - 1).join('\n');
      if (new RegExp(`expect\\s*\\(\\s*${guard.replace(/[.$]/g, '\\$&')}\\s*[,)]`).test(before)) return null;
    }
    return 'assertion is conditional — it may never execute; assert unconditionally';
  },
};

interface BraceState { depth: number; started: boolean }

/** Update brace depth / started flag across one line's characters. */
function scanBraces(line: string, st: BraceState): void {
  for (const ch of line) {
    if (ch === '{') { st.depth++; st.started = true; }
    else if (ch === '}') st.depth--;
  }
}

// Body of an it()/test() block: lines from the opening to the matching brace depth 0.
function blockBody(full: string, fromLine1: number): string {
  const lines = full.split('\n');
  const st: BraceState = { depth: 0, started: false };
  const out: string[] = [];
  for (let i = fromLine1 - 1; i < lines.length; i++) {
    out.push(lines[i]);
    scanBraces(lines[i], st);
    if (st.started && st.depth <= 0) break;
    if (out.length > 60) break;
  }
  return out.join('\n');
}

// Escape a literal for safe embedding in a RegExp.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
