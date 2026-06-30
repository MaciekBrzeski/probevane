import type { QualityReport } from './analyze.js';

// Render a QualityReport as a SARIF 2.1.0 log so the quality gate can feed
// GitHub code-scanning / any SARIF viewer. One result per violation; severity
// maps error->error, warn->warning.

/** Convert a quality report to a SARIF 2.1.0 log object. */
export function toSarif(report: QualityReport): object {
  const rules = [...new Set(report.violations.map((v) => v.rule))].map((id) => ({ id }));
  const results = report.violations.map((v) => ({
    ruleId: v.rule,
    level: v.severity === 'error' ? 'error' : 'warning',
    message: { text: v.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: v.file },
          region: { startLine: v.line },
        },
      },
    ],
  }));
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{ tool: { driver: { name: 'probevane-quality', rules } }, results }],
  };
}
