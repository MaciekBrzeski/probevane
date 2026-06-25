import type { AuditRule } from '../adapters/adapter.js';

// Python (pytest) audit rules — the python adapter's contribution to the shared
// audit engine. Mirrors the JS rules' intent for pytest idioms.
export function pyAuditRules(): AuditRule[] {
  return [
    {
      id: 'py-no-sleep',
      severity: 'error',
      check: (line) =>
        /\btime\.sleep\s*\(/.test(line) ? 'time.sleep in a test is brittle — wait on a condition instead' : null,
    },
    {
      id: 'py-no-skip',
      severity: 'warn',
      check: (line) =>
        /@pytest\.mark\.skip\b/.test(line) ? 'skipped test — a skipped test covers nothing' : null,
    },
    {
      id: 'py-assert-in-test',
      severity: 'error',
      // A `def test_*` body must contain an `assert` (or pytest.raises) within 25 lines.
      check: (line, lineNo, _file, full) => {
        const m = line.match(/^\s*def\s+(test_\w+)\s*\(/);
        if (!m) return null;
        const body = full.split('\n').slice(lineNo, lineNo + 25).join('\n');
        return /\bassert\b|pytest\.raises|\.assert_/.test(body)
          ? null
          : `test ${m[1]} has no assertion within 25 lines — assertion-free test`;
      },
    },
  ];
}
