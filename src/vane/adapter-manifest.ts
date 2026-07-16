import type { AdapterCommands, StackAdapter, AuditRule } from '../adapters/adapter.js';
import { goAuditRules } from '../audit/rules-go.js';
import { jsAuditRules } from '../audit/rules-js.js';
import { pyAuditRules } from '../audit/rules-py.js';
import { rustAuditRules } from '../audit/rules-rust.js';
import { vueAuditRules } from '../audit/rules-vue.js';
import { loadPrompt } from '../library/prompt.js';
import { loadAdapterManifest } from './load.js';

// Adapter manifests — the DATA fields of a StackAdapter (commands, guidance,
// patterns pointer, audit-rules ref) declared in vane/adapters/<id>.vane and
// turned into the adapter's method implementations here. PARTIAL by design:
// an adapter spreads manifestFields(id) over its TS definition, so anything
// the manifest doesn't declare keeps its TS implementation (python's
// dir-dependent commands() can never migrate, and that's fine).

/** Named audit rulesets a manifest may reference — a CLOSED registry, so a
 *  typo'd ref fails at manifest load, not silently at gate time. */
const AUDIT_RULESETS: Record<string, () => AuditRule[]> = {
  go: goAuditRules,
  js: jsAuditRules,
  py: pyAuditRules,
  rust: rustAuditRules,
  vue: vueAuditRules,
};

/** Manifest command keys (kebab) → AdapterCommands fields. */
const COMMAND_KEYS: Record<string, keyof AdapterCommands> = {
  typecheck: 'typecheck', lint: 'lint', 'test-unit': 'testUnit', 'test-e2e': 'testE2e', coverage: 'coverage',
};

/** Build the manifest-backed method implementations for one adapter, or null
 *  when the stack ships no manifest (fully-TS adapter). Throws on unknown
 *  command keys / ruleset refs — a manifest error must never no-op silently. */
export function manifestFields(id: string): Partial<StackAdapter> | null {
  const m = loadAdapterManifest(id);
  if (!m) return null;
  const out: Partial<StackAdapter> = {};
  if (Object.keys(m.commands).length) {
    const cmds = {} as AdapterCommands;
    for (const [key, value] of Object.entries(m.commands)) {
      const field = COMMAND_KEYS[key];
      if (!field) throw new Error(`vane: adapter ${id}: unknown command key '${key}'`);
      cmds[field] = value;
    }
    out.commands = () => cmds;
  }
  if (Object.keys(m.guidance).length) out.guidance = (kind) => m.guidance[kind] ?? '';
  if (Object.keys(m.patterns).length) out.patternsDoc = (kind) => loadPrompt(m.patterns[kind] ?? '');
  if (m.auditRules) {
    const rules = AUDIT_RULESETS[m.auditRules];
    if (!rules) throw new Error(`vane: adapter ${id}: unknown audit-rules ref '${m.auditRules}'`);
    out.auditRules = rules;
  }
  return out;
}
