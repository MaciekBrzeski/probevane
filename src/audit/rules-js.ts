import type { AuditRule } from '../adapters/adapter.js';

// JS/TS audit rules, ported from qaforge/src/cli/audit.ts and extended with
// React-unit-specific rules. The shared engine lives in audit/core.ts (P2);
// these are the language-specific rules the React adapter contributes.
//
// Suppression: a line (or the line above) containing "probevane-allow: <rule-id>"
// silences that rule. Handled in core.ts; rules here just detect.

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
      check: (line) =>
        line.includes('waitForTimeout')
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
      // API mutation in e2e must be followed by a status assertion.
      check: (line, lineNo, _file, full) => {
        const mut = line.match(/\.(post|put|patch|delete)\s*\(/);
        if (!mut) return null;
        if (/\.catch\s*\(/.test(line)) return null;
        const window = full.split('\n').slice(lineNo, lineNo + 8).join('\n');
        return /expect\s*\(\s*\w+\.status\s*\(\s*\)\s*\)/.test(window)
          ? null
          : `${mut[1].toUpperCase()} call not followed by a status assertion within 8 lines`;
      },
    },
    {
      id: 'assertion-free-block',
      severity: 'error',
      // A test case with no assertion in its body (coverage theatre).
      check: (line, lineNo, _file, full) => {
        const m = line.match(/\b(it|test)\s*(\.\w+)?\s*\(/);
        if (!m || /\.(skip|todo)\b/.test(line)) return null;
        const body = blockBody(full, lineNo);
        return /\bexpect\s*\(|\bassert\b|\.toHaveBeenCalled/.test(body)
          ? null
          : 'test case has no assertion — every test must assert observable behavior';
      },
    },
  ];
}

// Assertion quality: assertions that exist but are weak/conditional, plus unused
// imports used to inflate module coverage.
function assertionQualityRules(): AuditRule[] {
  return [
    {
      id: 'conditional-expect',
      severity: 'error',
      // An assertion guarded by a condition may silently never run — a classic
      // way a test "passes" without testing anything.
      check: (line) =>
        /\bif\s*\([^)]*\)\s*(\x7b)?\s*(await\s+)?expect\s*\(/.test(line) ||
        /[?&|]{1,2}\s*(await\s+)?expect\s*\(/.test(line)
          ? 'assertion is conditional — it may never execute; assert unconditionally'
          : null,
    },
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
