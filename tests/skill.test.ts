import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COMMANDS, UNDOCUMENTED, binCommands } from '../src/skill/catalog.js';
import { buildSkill, buildWikiCommands, SKILL_PATH, WIKI_COMMANDS_PATH } from '../src/skill/build.js';

describe('control skill ↔ bin bijection', () => {
  it('every documented command is dispatchable by bin', async () => {
    const bin = new Set(await binCommands());
    expect(bin.size).toBeGreaterThan(0);
    for (const c of COMMANDS) expect(bin.has(c.name), `bin missing ${c.name}`).toBe(true);
  });
  it('every real bin command is documented (or explicitly undocumented)', async () => {
    const cat = new Set(COMMANDS.map((c) => c.name));
    for (const b of await binCommands()) {
      if (UNDOCUMENTED.has(b)) continue;
      expect(cat.has(b), `bin command ${b} not in catalog — add it`).toBe(true);
    }
  });
  it('renderers are deterministic', () => {
    expect(buildSkill()).toBe(buildSkill());
    expect(buildWikiCommands()).toBe(buildWikiCommands());
  });
});

describe('generated artifacts not stale (drift gate)', () => {
  it('committed SKILL.md matches the catalog', async () => {
    const onDisk = await readFile(SKILL_PATH, 'utf8').catch(() => '');
    expect(onDisk, 'run `probevane skill` to regenerate').toBe(buildSkill());
  });
  it('committed wiki Commands.md matches the catalog', async () => {
    const onDisk = await readFile(WIKI_COMMANDS_PATH, 'utf8').catch(() => '');
    expect(onDisk, 'run `probevane skill` to regenerate').toBe(buildWikiCommands());
  });
});

describe('wiki link integrity (no broken nav)', () => {
  it('every relative .md link resolves to an existing page', async () => {
    const dir = 'docs/wiki';
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
    const present = new Set(files);
    const broken: string[] = [];
    for (const f of files) {
      const md = await readFile(join(dir, f), 'utf8');
      for (const m of md.matchAll(/\]\(([A-Za-z0-9._-]+\.md)\)/g)) {
        if (!present.has(m[1])) broken.push(`${f} → ${m[1]}`);
      }
    }
    expect(broken, `broken wiki links: ${broken.join(', ')}`).toEqual([]);
  });

  it('every generated project spec page is well-formed', async () => {
    const dir = 'docs/wiki';
    const projects = (await readdir(dir)).filter((f) => f.startsWith('project-') && f.endsWith('.md'));
    expect(projects.length, 'no project spec pages').toBeGreaterThan(0);
    for (const f of projects) {
      const md = await readFile(join(dir, f), 'utf8');
      expect(md, `${f} missing a title`).toMatch(/^#\s+\S/m);
      expect(md, `${f} missing module graph`).toMatch(/Module graph/i);
    }
  });

  it('probevane has its own dogfood spec page', async () => {
    const md = await readFile('docs/wiki/project-probevane.md', 'utf8').catch(() => '');
    expect(md, 'run `probevane spec . --wiki`').toMatch(/# probevane/);
  });
});
