import type { AuditRule } from '../adapters/adapter.js';
import { jsAuditRules } from './rules-js.js';

// Vue audit = the shared JS/TS rules + Vue-specific ones. The JS rules
// (no-only, assertion-free-block, conditional-expect, …) apply unchanged.
export function vueAuditRules(): AuditRule[] {
  return [
    ...jsAuditRules(),
    {
      id: 'vue-await-trigger',
      severity: 'warn',
      // trigger() returns a promise; not awaiting it races the DOM update.
      check: (line) =>
        /\.trigger\(/.test(line) && !/await\s/.test(line) && !/return\s/.test(line)
          ? 'trigger() not awaited — await it so the DOM updates before you assert'
          : null,
    },
  ];
}
