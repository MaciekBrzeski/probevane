import { describe, it, expect } from 'vitest';
import { authHeader, witBase, fieldPatch, triggerWiql, parseDirective, summarize } from '../src/integrations/ado.js';

describe('ado auth + urls', () => {
  it('authHeader is Basic base64(:pat)', () => {
    expect(authHeader('abc')).toBe('Basic ' + Buffer.from(':abc').toString('base64'));
  });
  it('witBase encodes the project', () => {
    expect(witBase('maciejbrzeski', 'probe vane')).toBe('https://dev.azure.com/maciejbrzeski/_apis/wit'.replace('/_apis', '/probe%20vane/_apis'));
  });
});

describe('ado field patch + wiql', () => {
  it('fieldPatch builds json-patch add ops', () => {
    expect(fieldPatch({ 'System.Title': 'x', 'System.State': 'Doing' })).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'x' },
      { op: 'add', path: '/fields/System.State', value: 'Doing' },
    ]);
  });
  it('triggerWiql filters by tag + state', () => {
    const q = triggerWiql('probevane', 'To Do');
    expect(q).toContain("[System.State] = 'To Do'");
    expect(q).toContain("[System.Tags] CONTAINS 'probevane'");
  });
});

describe('ado parseDirective', () => {
  it('parses a tagged generate directive with flags', () => {
    const d = parseDirective('[probevane] generate fixtures/react-todo --kind unit --only Foo.tsx')!;
    expect(d).toMatchObject({ command: 'generate', dir: 'fixtures/react-todo', kind: 'unit', only: 'Foo.tsx' });
  });
  it('parses fix with a --task from the description', () => {
    const d = parseDirective('probevane: fix ./app', 'fix ./app --task "handle the null case"')!;
    expect(d.command).toBe('fix');
    expect(d.dir).toBe('./app');
    expect(d.task).toBe('handle the null case');
  });
  it('detects e2e kind', () => {
    expect(parseDirective('generate ./app --kind e2e')!.kind).toBe('e2e');
  });
  it('defaults kind=unit and dir=. ', () => {
    const d = parseDirective('[probevane] repair')!;
    expect(d.kind).toBe('unit');
    expect(d.dir).toBe('.');
  });
  it('returns null when no command present', () => {
    expect(parseDirective('Buy milk and fix the sink')).not.toBeNull(); // "fix" is a command
    expect(parseDirective('Buy milk for the office')).toBeNull();
  });
});

describe('ado summarize', () => {
  it('prefers the final [probevane] outcome line over inner engine logs', () => {
    const out = '[engine]   ACCEPTED (all gates green)\n[probevane] ACCEPTED (accepted) steps=4 tokens=10/20\ntrailing';
    expect(summarize(out)).toContain('[probevane] ACCEPTED (accepted) steps=4');
  });
});
