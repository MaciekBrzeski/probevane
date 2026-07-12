import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { ToolCall } from '../types.js';
import { WRITE_TOOLS } from '../tools.js';

// Runes for the narrative documentation loop (run-docs.ts). The loop writes a
// long-form markdown guide grounded in a stack-agnostic project digest; these
// runes inject that context, keep the loop docs-only, and gate on structure +
// reference-integrity (no hallucinated paths) before accepting.

const CODE_DENY = [
  /(^|\/)node_modules\//, /(^|\/)\.git\//, /(^|\/)(dist|build|coverage|target)\//,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock)$/,
];

/** Read the guide being written (absolute outPath honored); null before the first write. */
function readDoc(ctx: RunCtx, outPath: string): string | null {
  const p = isAbsolute(outPath) ? outPath : join(ctx.workdir, outPath); // join mangles an absolute outPath
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

/** Inject the project digest + a docs-writing rubric (replaces context_inject). */
export function docsContextInject(digest: string, sections: string[], outPath: string): Rune {
  return {
    name: 'docs_context_inject',
    async prepare(): Promise<string> {
      return [
        'You are writing COMPREHENSIVE, ACCURATE project documentation as Markdown.',
        `Write the guide to \`${outPath}\` (use write_file; you may read any source file first).`,
        `Required H2 sections (in order): ${sections.map((s) => `"${s}"`).join(', ')}.`,
        'RULES:',
        '- Ground every statement in the digest below or a file you actually read. Do NOT invent files, APIs, commands, or behavior.',
        '- Reference real repo paths only (e.g. `src/loop/engine.ts`); a path that does not exist will fail the reference gate.',
        '- Be thorough: explain what the project is, why it exists, how it is structured, how the pieces fit, and how to build/run/use it.',
        '- Complement (do not contradict) any existing README/CLAUDE.md shown in the digest.',
        '',
        '====================  PROJECT DIGEST  ====================',
        digest,
      ].join('\n');
    },
  };
}

/** Keep the loop docs-only: allow writing Markdown, block writes to code/build. */
export function docsScopeGuard(): Rune {
  return {
    name: 'docs_scope_guard',
    systemPromptAddition(): string {
      return 'SCOPE: this is a documentation run — only create/edit Markdown (.md) files. Do not modify source code, configs, or build files. Read source freely to ground the docs.';
    },
    async beforeToolCall(call: ToolCall): Promise<RuneDecision> {
      if (!WRITE_TOOLS.has(call.name) && call.name !== 'delete_file') return ALLOW;
      const path = String((call.input as { path?: string }).path ?? '');
      if (CODE_DENY.some((re) => re.test(path)))
        return block(`docs_scope_guard: off-limits path (${path})`, `${path} is off-limits. Write documentation only.`);
      if (!/\.mdx?$/.test(path))
        return block(
          `docs_scope_guard: not a markdown file (${path})`,
          `This is a documentation run — only write .md files. Put the documentation in the target guide instead of editing ${path}.`,
        );
      return ALLOW;
    },
  };
}

/** Finish gate: the guide exists with an H1 and every required section, non-trivial. */
export function docStructureGate(outPath: string, sections: string[]): Rune {
  return {
    name: 'doc_structure_gate',
    systemPromptAddition(): string {
      return `STRUCTURE: the guide must have a top-level "# " title and an H2 "## " heading for each of: ${sections.join(', ')}, each with real content.`;
    },
    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      const md = readDoc(ctx, outPath);
      if (!md) return block('doc_structure_gate: no guide written', `Write the documentation to ${outPath} first.`);
      if (!/^#\s+\S/m.test(md)) return block('doc_structure_gate: missing H1 title', `${outPath} needs a top-level "# Title".`);
      const missing: string[] = [];
      for (const s of sections) {
        // section present as an H2 (heading text contains the section words, case-insensitive)
        const re = new RegExp(`^##\\s+.*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '.*')}`, 'im');
        const m = md.match(re);
        if (!m) { missing.push(`missing section "${s}"`); continue; }
        // body length: text from this heading to the next H2
        const start = md.indexOf(m[0]);
        const rest = md.slice(start + m[0].length);
        const body = rest.split(/^##\s+/m)[0] ?? '';
        if (body.trim().length < 200) missing.push(`section "${s}" too thin (<200 chars)`);
      }
      if (missing.length)
        return block(`doc_structure_gate: ${missing.length} issue(s)`, `Fix these in ${outPath}:\n- ${missing.join('\n- ')}`);
      return ALLOW;
    },
  };
}

/** A markdown-link target reduced to a repo path, or null (external/anchor). */
function linkRef(target: string): string | null {
  if (/^(https?:|mailto:|#|\/\/)/.test(target) || target.includes('://')) return null;
  const t = target.replace(/[#?].*$/, '').replace(/^\.\//, '');
  return t || null;
}

/** A backticked token reduced to a path-like ref (slash + extension), or null. */
function backtickRef(token: string): string | null {
  const t = token.trim();
  if (/\s/.test(t) || t.includes('*') || t.includes('://')) return null;
  const cleaned = t.replace(/:\d+(:\d+)?$/, '').replace(/\/$/, ''); // strip line:col, trailing slash
  return /\//.test(cleaned) && /\.[a-zA-Z0-9]{1,6}$/.test(cleaned) ? cleaned : null;
}

/** Extract repo-path-shaped references from the markdown (links + path-like backticks). */
export function extractRefs(md: string): string[] {
  const refs = new Set<string>();
  // markdown links [text](target)
  for (const m of md.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const r = linkRef(m[1]);
    if (r) refs.add(r);
  }
  // backticked path-like tokens: contain a slash AND end in an extension
  for (const m of md.matchAll(/`([^`]+)`/g)) {
    const r = backtickRef(m[1]);
    if (r) refs.add(r);
  }
  return [...refs];
}

/** Finish gate (anti-hallucination): every repo path the guide cites must exist. */
export function docReferenceGate(outPath: string, log?: (l: string) => void): Rune {
  return {
    name: 'doc_reference_gate',
    systemPromptAddition(): string {
      return 'REFERENCES: only cite repo paths that actually exist. A cited path that is not on disk will block the run.';
    },
    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      const md = readDoc(ctx, outPath);
      if (!md) return ALLOW; // structure gate handles the missing-file case
      const refs = extractRefs(md);
      const missing = refs.filter((r) => !existsSync(join(ctx.workdir, r)));
      if (missing.length) {
        log?.(`[doc_reference_gate] flagged ${missing.length}/${refs.length} refs: ${missing.join(', ')}`);
        return block(
          `doc_reference_gate: ${missing.length} cited path(s) do not exist`,
          `These paths cited in ${outPath} do not exist — fix or remove them (cite only real files):\n- ${missing.join('\n- ')}`,
        );
      }
      return ALLOW;
    },
  };
}

/** Finish gate: the guide is present and substantial. */
export function docsAcceptance(outPath: string, minChars = 800): Rune {
  return {
    name: 'docs_acceptance',
    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      const md = readDoc(ctx, outPath);
      if (!md || md.trim().length < minChars)
        return block(
          `docs_acceptance: guide too short (${md ? md.trim().length : 0}/${minChars} chars)`,
          `The documentation at ${outPath} is not comprehensive enough yet — expand it past ${minChars} characters.`,
        );
      return ALLOW;
    },
  };
}
