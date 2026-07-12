import { COMMANDS } from './catalog.js';

// Render the catalog → a Claude skill (SKILL.md) AND a wiki command reference.
// Deterministic: same catalog → same bytes, so a drift gate compares committed
// vs generated and keeps both in sync with the bin dispatcher.
export const SKILL_PATH = '.claude/skills/probevane/SKILL.md';
export const WIKI_COMMANDS_PATH = 'docs/wiki/Commands.md';

/** Generated wiki command reference (same catalog as the skill → always synced). */
export function buildWikiCommands(): string {
  const rows = COMMANDS.map((c) => `| \`${c.name}\` | ${c.summary} |`).join('\n');
  const detail = COMMANDS.map((c) => `### ${c.name}\n${c.summary}\n\n\`\`\`bash\n${c.usage}\n# e.g. ${c.example}\n\`\`\``).join('\n\n');
  return `# Commands

_Generated from \`src/skill/catalog.ts\` by \`probevane skill\` — do not edit by hand. CI gates drift._

The CLI is \`./bin/probevane <command> <dir> [flags]\`. Loop commands need \`ANTHROPIC_API_KEY\` (or \`--model local:<id>\`). See [CLI](CLI.md) for the narrative intro and [Paths](Paths.md) for the task paths.

| command | what it does |
|---|---|
${rows}

## Reference

${detail}
`;
}

/** Generated SKILL.md — frontmatter + invocation guide + the same catalog
 *  rows/detail as the wiki, so the skill can never drift from the dispatcher. */
export function buildSkill(): string {
  const rows = COMMANDS.map((c) => `| \`${c.name}\` | ${c.summary} |`).join('\n');
  const detail = COMMANDS.map((c) => `### ${c.name}\n${c.summary}\n\n\`\`\`\n${c.usage}\n# e.g.\n${c.example}\n\`\`\``).join('\n\n');
  return `---
name: probevane
description: Drive probevane — a gated agentic harness that adds, refactors, and fixes tests across React/Vue/Svelte/Node/Python/Go/Rust. Use to generate tests, run TDD features, characterization refactors, repair stale tests, review+autofix PRs, grade/benchmark suites, and produce specs/graphs. Invoke for any "add tests / refactor / fix / review my code" request on a real project.
---

# probevane

A gated agentic harness for tests + safe code change. Every run is verified by **gates** (typecheck, suite green, audit-clean, hermetic, coverage/mutation) — it only finishes when the work is real. Stacks auto-detected: React, Vue, Svelte, plain Node/TS, Python (pytest), Go (cargo→go test), Rust (cargo test).

> This file is GENERATED from \`src/skill/catalog.ts\` by \`probevane skill\`. Do not edit by hand — run \`probevane skill\` to regenerate. CI gates drift (\`probevane skill --check\`).

## Invocation

Run the CLI: \`./bin/probevane <command> <dir> [flags]\` (or \`npx probevane …\`). Most commands take a project directory and print a result; the loop commands need \`ANTHROPIC_API_KEY\` (or \`--model local:<id>\` for a local OpenAI-compatible server). Per-project defaults live in \`probevane.config.{ts,json}\`; CLI flags override.

## Choosing a command

- **Add tests** → \`generate\` (use \`--mock\` for networked apps, \`--passk N\` to keep the best of N, \`--target-gaps\` to chase uncovered lines).
- **Change code safely** → \`refactor\` (behavior preserved by the existing tests) ; **add a feature** → \`feature\` (TDD, red-first).
- **Tests went stale after a change** → \`repair\`. **Fix described bugs** → \`fix\`.
- **On a PR** → \`ci --review-fix\` (review the diff, gated, auto-fix). **Judge a suite** → \`review\` / \`bench\`.
- **Understand a repo** → \`graph\`, \`spec\`. **Mocks only** → \`mock\`.

## Commands

| command | what it does |
|---|---|
${rows}

## Reference

${detail}

## Safety + cost

- All loop commands are **gated**: they cannot finish red, audit-broken, non-hermetic, or below coverage. Issue-discovery (\`review\`) is itself gated — findings are grounded + adversarially verified before any auto-fix.
- \`--budget N\` caps output tokens (a stuck loop stops). \`--model auto\` routes complex code to a stronger model up front (cheaper than churning a weak one).
- Runs never edit \`node_modules\`/build/lockfiles (path_guard) and never weaken existing tests.
`;
}
