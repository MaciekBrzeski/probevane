import type { AuditRule } from '../adapters/adapter.js';

// Rust (cargo test) audit rules.
export function rustAuditRules(): AuditRule[] {
  return [
    {
      id: 'rust-no-sleep',
      severity: 'error',
      check: (line) => (/\bthread::sleep\b/.test(line) ? 'thread::sleep in a test is brittle — synchronize instead' : null),
    },
    {
      id: 'rust-no-ignore',
      severity: 'warn',
      check: (line) => (/#\[ignore\]/.test(line) ? 'ignored test — it covers nothing' : null),
    },
    {
      id: 'rust-assert-in-test',
      severity: 'error',
      // a `fn ...() ` under #[test] must assert
      check: (line, lineNo, _file, full) => {
        const prev = full.split('\n')[lineNo - 2] ?? '';
        if (!/#\[test\]/.test(prev)) return null;
        const m = line.match(/fn\s+(\w+)/);
        if (!m) return null;
        const body = full.split('\n').slice(lineNo, lineNo + 30).join('\n');
        return /assert!|assert_eq!|assert_ne!|\.unwrap\(\)|panic!/.test(body) ? null : `${m[1]} has no assertion within 30 lines`;
      },
    },
  ];
}
