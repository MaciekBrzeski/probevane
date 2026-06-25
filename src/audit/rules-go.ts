import type { AuditRule } from '../adapters/adapter.js';

// Go (stdlib testing) audit rules.
export function goAuditRules(): AuditRule[] {
  return [
    {
      id: 'go-no-sleep',
      severity: 'error',
      check: (line) => (/\btime\.Sleep\s*\(/.test(line) ? 'time.Sleep in a test is brittle — synchronize instead' : null),
    },
    {
      id: 'go-no-skip',
      severity: 'warn',
      check: (line) => (/\bt\.Skip\s*\(\s*\)/.test(line) ? 'unconditional t.Skip() — the test covers nothing' : null),
    },
    {
      id: 'go-assert-in-test',
      severity: 'error',
      // A `func TestXxx(t *testing.T)` body must assert (t.Error/Errorf/Fatal/Fatalf).
      check: (line, lineNo, _file, full) => {
        const m = line.match(/^func\s+(Test\w+)\s*\(\s*\w+\s+\*testing\.T\s*\)/);
        if (!m) return null;
        const body = full.split('\n').slice(lineNo, lineNo + 40).join('\n');
        return /t\.(Error|Errorf|Fatal|Fatalf)\b/.test(body) ? null : `${m[1]} has no assertion (t.Error/Fatal) within 40 lines`;
      },
    },
  ];
}
