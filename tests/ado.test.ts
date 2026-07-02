import { describe, it, expect } from 'vitest';
import { adoClient, authHeader, witBase, fieldPatch, triggerWiql, parseDirective, summarize } from '../src/integrations/ado.js';

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
  it('decodes an HTML-encoded description (ADO stores it as HTML)', () => {
    // ADO returns System.Description as HTML: quotes → &quot;, body wrapped in tags.
    const d = parseDirective('[probevane] feature .', '<div>feature . --kind unit --task &quot;add blink module&quot;</div>')!;
    expect(d).toMatchObject({ command: 'feature', dir: '.', task: 'add blink module' });
  });
  it('tolerates a TRUNCATED description (lost closing quote) — takes the rest as the task', () => {
    // ADO can truncate a long Description, dropping the closing &quot;.
    const d = parseDirective('[probevane] feature .', 'feature . --kind unit --task &quot;add a long blink module that got cut off')!;
    expect(d.command).toBe('feature');
    expect(d.task).toBe('add a long blink module that got cut off');
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
  it('falls back to any ACCEPTED/stopReason line, then the last output line', () => {
    expect(summarize('setup\nstopReason=budget hit\ndone')).toBe('stopReason=budget hit');
    expect(summarize('just\nplain output')).toBe('plain output');
  });
});

// ===========================================================================
// adoClient — fetch glue driven by an injected fake fetch (no network)
// ===========================================================================
const CFG = { org: 'myorg', project: 'my proj', pat: 'secret' };
const BASE = 'https://dev.azure.com/myorg/my%20proj/_apis/wit';

interface Call { url: string; init: RequestInit | undefined }

/** Fake fetch: records every call, answers each with the next canned body. */
function fakeFetch(...bodies: unknown[]) {
  const calls: Call[] = [];
  const fn = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = bodies.length > 1 ? bodies[calls.length - 1] : bodies[0];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as typeof fetch;
  return { fn, calls };
}

/** Fake fetch that always fails with an HTTP error status. */
function failFetch(status: number, bodyText: string | Error) {
  const fn = (async () =>
    ({
      ok: false,
      status,
      json: async () => ({}),
      text: async () => {
        if (bodyText instanceof Error) throw bodyText;
        return bodyText;
      },
    }) as unknown as Response) as typeof fetch;
  return fn;
}

describe('adoClient (fake fetch)', () => {
  it('query POSTs the WIQL to /wiql with auth + json headers, returns the ids', async () => {
    const { fn, calls } = fakeFetch({ workItems: [{ id: 3 }, { id: 7 }] });
    const ids = await adoClient(CFG, fn).query('SELECT [System.Id] FROM WorkItems');
    expect(ids).toEqual([3, 7]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/wiql?api-version=7.1`);
    expect(calls[0].init?.method).toBe('POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(authHeader('secret'));
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ query: 'SELECT [System.Id] FROM WorkItems' });
  });

  it('query with no workItems in the response → []', async () => {
    const { fn } = fakeFetch({});
    expect(await adoClient(CFG, fn).query('q')).toEqual([]);
  });

  it('getMany maps fields to AdoWorkItem, splitting + trimming tags', async () => {
    const { fn, calls } = fakeFetch({
      value: [
        {
          id: 5,
          fields: {
            'System.Title': 'do it',
            'System.State': 'To Do',
            'System.Description': '<div>desc</div>',
            'System.Tags': 'probevane; urgent ;',
          },
        },
        { id: 6, fields: {} }, // all fields missing → defaults
      ],
    });
    const items = await adoClient(CFG, fn).getMany([5, 6]);
    expect(items[0]).toEqual({
      id: 5, title: 'do it', state: 'To Do', description: '<div>desc</div>', tags: ['probevane', 'urgent'],
    });
    expect(items[1]).toEqual({ id: 6, title: '', state: '', description: '', tags: [] });
    expect(calls[0].url).toContain(`${BASE}/workitems?ids=5,6&fields=System.Title`);
  });

  it('getMany with no ids short-circuits — no fetch at all', async () => {
    const { fn, calls } = fakeFetch({});
    expect(await adoClient(CFG, fn).getMany([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('getMany with no value array in the response → []', async () => {
    const { fn } = fakeFetch({});
    expect(await adoClient(CFG, fn).getMany([1])).toEqual([]);
  });

  it('create POSTs a json-patch doc to workitems/$<type> (type url-encoded) and returns the id', async () => {
    const { fn, calls } = fakeFetch({ id: 42 });
    const id = await adoClient(CFG, fn).create('User Story', { 'System.Title': 'add tests' });
    expect(id).toBe(42);
    expect(calls[0].url).toBe(`${BASE}/workitems/$User%20Story?api-version=7.1`);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json-patch+json');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'add tests' },
    ]);
  });

  it('setState PATCHes System.State via json-patch', async () => {
    const { fn, calls } = fakeFetch({});
    await adoClient(CFG, fn).setState(7, 'Doing');
    expect(calls[0].url).toBe(`${BASE}/workitems/7?api-version=7.1`);
    expect(calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([
      { op: 'add', path: '/fields/System.State', value: 'Doing' },
    ]);
  });

  it('comment POSTs {text} to the comments preview endpoint with plain-json headers', async () => {
    const { fn, calls } = fakeFetch({});
    await adoClient(CFG, fn).comment(7, 'progress: 3/5 gates green');
    expect(calls[0].url).toBe(`${BASE}/workItems/7/comments?api-version=7.1-preview.3`);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json'); // NOT json-patch
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ text: 'progress: 3/5 gates green' });
  });

  it('update PATCHes arbitrary fields via json-patch', async () => {
    const { fn, calls } = fakeFetch({});
    await adoClient(CFG, fn).update(9, { 'System.Description': '<div>new</div>', 'System.Title': 't' });
    expect(calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([
      { op: 'add', path: '/fields/System.Description', value: '<div>new</div>' },
      { op: 'add', path: '/fields/System.Title', value: 't' },
    ]);
  });

  it('describe returns the current description; missing fields → empty string', async () => {
    const { fn: withDesc, calls } = fakeFetch({ fields: { 'System.Description': '<p>hi</p>' } });
    expect(await adoClient(CFG, withDesc).describe(3)).toBe('<p>hi</p>');
    expect(calls[0].url).toBe(`${BASE}/workitems/3?fields=System.Description&api-version=7.1`);
    const { fn: noFields } = fakeFetch({});
    expect(await adoClient(CFG, noFields).describe(3)).toBe('');
  });

  it('attach uploads octet-stream bytes (filename url-encoded) → {id, url}', async () => {
    const { fn, calls } = fakeFetch({ id: 'att-1', url: 'https://dev.azure.com/att/1', extra: 'ignored' });
    const data = new Uint8Array([1, 2, 3]);
    const out = await adoClient(CFG, fn).attach('run log.txt', data);
    expect(out).toEqual({ id: 'att-1', url: 'https://dev.azure.com/att/1' });
    expect(calls[0].url).toBe(`${BASE}/attachments?fileName=run%20log.txt&api-version=7.1`);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers.authorization).toBe(authHeader('secret'));
    expect(calls[0].init?.body).toBe(data);
  });

  it('linkAttachment PATCHes an AttachedFile relation carrying the comment', async () => {
    const { fn, calls } = fakeFetch({});
    await adoClient(CFG, fn).linkAttachment(7, 'https://dev.azure.com/att/1', 'coverage report');
    expect(calls[0].url).toBe(`${BASE}/workitems/7?api-version=7.1`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([
      {
        op: 'add',
        path: '/relations/-',
        value: { rel: 'AttachedFile', url: 'https://dev.azure.com/att/1', attributes: { comment: 'coverage report' } },
      },
    ]);
  });

  it('HTTP error → throws "ADO <status>: <body>" (query, getMany, create, setState alike)', async () => {
    const c = adoClient(CFG, failFetch(401, 'bad PAT'));
    await expect(c.query('q')).rejects.toThrow('ADO 401: bad PAT');
    await expect(c.getMany([1])).rejects.toThrow('ADO 401: bad PAT');
    await expect(c.create('Task', { 'System.Title': 'x' })).rejects.toThrow('ADO 401: bad PAT');
    await expect(c.setState(1, 'Done')).rejects.toThrow('ADO 401: bad PAT');
  });

  it('HTTP error with an unreadable body still throws with the status (text() catch → "")', async () => {
    const c = adoClient(CFG, failFetch(500, new Error('stream torn')));
    await expect(c.comment(1, 'x')).rejects.toThrow('ADO 500: ');
  });
});
