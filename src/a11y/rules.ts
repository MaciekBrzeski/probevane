import type { AuditRule } from '../adapters/adapter.js';

// Static accessibility rules over component source (JSX / Vue / Svelte markup).
// Conservative checks — a fast first pass that catches common high-signal a11y
// defects without rendering. Tag-spanning so multiline JSX isn't a false
// positive. (The a11y gate adds runtime jest-axe assertions.) Suppress with
// `probevane-allow: <rule-id>`.

// Grab the full opening tag starting at line `lineNo` (1-based), across lines, up to the closing `>`.
function tagAt(full: string, lineNo: number): string {
  const rest = full.split('\n').slice(lineNo - 1).join('\n');
  const end = rest.indexOf('>');
  return end === -1 ? rest.slice(0, 400) : rest.slice(0, end + 1);
}

const imgAltRule: AuditRule = {
  id: 'a11y-img-alt',
  severity: 'error',
  check: (line, lineNo, _f, full) =>
    /<img\b/.test(line) && !/\balt=/.test(tagAt(full, lineNo)) ? '<img> without alt — add alt="" (decorative) or a description' : null,
};

const positiveTabindexRule: AuditRule = {
  id: 'a11y-positive-tabindex',
  severity: 'warn',
  check: (line) =>
    /\btab[Ii]ndex\s*=\s*["{]?\s*[1-9]/.test(line) ? 'positive tabindex disrupts focus order — use 0 or -1' : null,
};

const clickNoRoleRule: AuditRule = {
  id: 'a11y-click-no-role',
  severity: 'warn',
  // onClick on a non-interactive element with no role → not keyboard-accessible.
  check: (line) => {
    const m = line.match(/<(div|span|li|p)\b[^>]*\son[Cc]lick/);
    if (!m) return null;
    return /\brole=/.test(line) ? null : `<${m[1]}> has onClick but no role — use a <button>, or add role + keyboard handler`;
  },
};

const inputLabelRule: AuditRule = {
  id: 'a11y-input-label',
  severity: 'warn',
  // an <input>/<select>/<textarea> needs an accessible name (aria-label or id+label).
  check: (line, lineNo, _f, full) => {
    const m = line.match(/<(input|select|textarea)\b/);
    if (!m) return null;
    const tag = tagAt(full, lineNo);
    if (/type=["']?(hidden|submit|button)/.test(tag)) return null;
    return /aria-label|aria-labelledby|\bid=/.test(tag) ? null : `<${m[1]}> has no accessible name — add aria-label or associate a <label>`;
  },
};

const anchorHrefRule: AuditRule = {
  id: 'a11y-anchor-href',
  severity: 'warn',
  check: (line, lineNo, _f, full) => {
    if (!/<a\b/.test(line)) return null;
    const tag = tagAt(full, lineNo);
    return !/\bhref=/.test(tag) && !/aria-/.test(tag) ? '<a> without href is not a link — use a <button> for actions' : null;
  },
};

const autofocusRule: AuditRule = {
  id: 'a11y-autofocus',
  severity: 'warn',
  check: (line) => (/\bauto[Ff]ocus\b/.test(line) ? 'autoFocus can disorient screen-reader / keyboard users — avoid' : null),
};

export function a11yRules(): AuditRule[] {
  return [imgAltRule, positiveTabindexRule, clickNoRoleRule, inputLabelRule, anchorHrefRule, autofocusRule];
}
