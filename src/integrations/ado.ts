// Azure DevOps integration — drive probevane loops from an ADO board and report
// progress back as state transitions + comments, so a run is observable on the
// board. Create a work item describing a test task → `probevane ado run` picks it
// up, runs the loop, moves the card (To Do → Doing → Done/blocked) and comments
// progress. REST api-version 7.1; auth = PAT (Basic). Pure helpers are exported
// for deterministic tests; the fetch client is a thin shell over them.

export interface AdoConfig {
  org: string;
  project: string;
  pat: string;
}

export interface AdoWorkItem {
  id: number;
  title: string;
  state: string;
  description: string;
  tags: string[];
}

/** Directive parsed from a work item → a probevane command to run. */
export interface AdoDirective {
  command: 'generate' | 'fix' | 'refactor' | 'feature' | 'repair';
  dir: string;
  kind: 'unit' | 'e2e';
  only?: string;
  task?: string; // for fix/feature/refactor (the --task text)
}

const COMMANDS = ['generate', 'fix', 'refactor', 'feature', 'repair'] as const;

/**
 * ADO stores the work-item Description as HTML, so quotes/ampersands arrive encoded
 * (`&quot;`, `&amp;`, `&#39;`) and the body may be wrapped in tags (`<div>…<br>`). Strip
 * tags + decode the common entities so directive parsing (esp. `--task "…"`) sees the
 * raw text. Without this, a `--task "…"` written in the description never matches.
 */
export function htmlToText(s: string): string {
  return s
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&'); // last: don't re-introduce entities
}

/** Basic auth header from a PAT (username empty, password = PAT). */
export function authHeader(pat: string): string {
  return 'Basic ' + Buffer.from(':' + pat).toString('base64');
}

/** Base URL for the Work Item Tracking API of an org/project. */
export function witBase(org: string, project: string): string {
  return `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/wit`;
}

/** A json-patch document setting work-item fields. */
export function fieldPatch(fields: Record<string, string>): Array<{ op: string; path: string; value: string }> {
  return Object.entries(fields).map(([k, value]) => ({ op: 'add', path: `/fields/${k}`, value }));
}

/** WIQL selecting trigger work items: a tag + a starting state, in this project. */
export function triggerWiql(tag: string, state: string): string {
  return (
    `SELECT [System.Id] FROM WorkItems ` +
    `WHERE [System.TeamProject] = @project ` +
    `AND [System.State] = '${state}' ` +
    `AND [System.Tags] CONTAINS '${tag}' ` +
    `ORDER BY [System.Id] ASC`
  );
}

/**
 * Parse a probevane directive from a work item's title/description.
 * Accepts e.g. "[probevane] generate fixtures/react-todo --kind unit --only Foo.tsx"
 * or a description line "probevane: fix ./app --task \"handle null\"". Returns null
 * if no command is found.
 */
export function parseDirective(title: string, description = ''): AdoDirective | null {
  const text = `${title}\n${htmlToText(description)}`.replace(/\[probevane\]|probevane:/gi, ' ');
  const lower = text.toLowerCase();
  const command = COMMANDS.find((c) => new RegExp(`\\b${c}\\b`).test(lower));
  if (!command) return null;
  const kind: 'unit' | 'e2e' = /\b(--kind\s+)?e2e\b/.test(lower) ? 'e2e' : 'unit';
  const only = text.match(/--only\s+(\S+)/)?.[1];
  // Prefer a fully-quoted task; but ADO can TRUNCATE a long Description (dropping the
  // closing quote), so fall back to "everything after --task" (strip a leading/trailing
  // quote). This keeps a too-long ticket working instead of failing with an empty task.
  const task =
    text.match(/--task\s+"([^"]+)"/)?.[1] ??
    text.match(/--task\s+'([^']+)'/)?.[1] ??
    text.match(/--task\s+["']?([\s\S]+?)["']?\s*$/)?.[1]?.trim();
  // dir: first token after the command that looks like a path (./x, x/y, or a bare dir)
  const after = text.slice(lower.indexOf(command) + command.length);
  const dir = after.match(/\s(\.?\/?[\w.-]+(?:\/[\w.-]+)*)/)?.[1] ?? '.';
  return { command, dir, kind, only, task };
}

/** One-line outcome summary from a probevane run's stdout — prefer the final
 *  `[probevane] … (accepted) steps=/tokens=` line, then any ACCEPTED/steps line. */
export function summarize(out: string): string {
  const lines = out.split('\n');
  const best =
    lines.reverse().find((l) => /\[probevane\].*(ACCEPTED|steps=)/.test(l)) ??
    lines.find((l) => /ACCEPTED|stopReason|steps=/.test(l));
  return best?.trim() ?? out.trim().split('\n').slice(-1)[0] ?? '(no output)';
}

// ---- fetch client -----------------------------------------------------------

export function adoClient(cfg: AdoConfig, doFetch: typeof fetch = fetch) {
  const base = witBase(cfg.org, cfg.project);
  const headers = { authorization: authHeader(cfg.pat), 'content-type': 'application/json' };

  async function json(res: Response): Promise<any> {
    if (!res.ok) throw new Error(`ADO ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  return {
    /** Run a WIQL query → the matching work item ids. */
    async query(wiql: string): Promise<number[]> {
      const res = await doFetch(`${base}/wiql?api-version=7.1`, {
        method: 'POST', headers, body: JSON.stringify({ query: wiql }),
      });
      const data = await json(res);
      return (data.workItems ?? []).map((w: any) => w.id);
    },

    /** Fetch fields for a set of work items. */
    async getMany(ids: number[]): Promise<AdoWorkItem[]> {
      if (!ids.length) return [];
      const fields = 'System.Title,System.State,System.Description,System.Tags';
      const res = await doFetch(`${base}/workitems?ids=${ids.join(',')}&fields=${fields}&api-version=7.1`, { headers });
      const data = await json(res);
      return (data.value ?? []).map((w: any) => ({
        id: w.id,
        title: w.fields?.['System.Title'] ?? '',
        state: w.fields?.['System.State'] ?? '',
        description: w.fields?.['System.Description'] ?? '',
        tags: String(w.fields?.['System.Tags'] ?? '').split(';').map((t: string) => t.trim()).filter(Boolean),
      }));
    },

    /** Create a work item of `type` with the given fields. Returns its id. */
    async create(type: string, fields: Record<string, string>): Promise<number> {
      const res = await doFetch(`${base}/workitems/$${encodeURIComponent(type)}?api-version=7.1`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json-patch+json' },
        body: JSON.stringify(fieldPatch(fields)),
      });
      return (await json(res)).id;
    },

    /** Move a work item to a new board state (e.g. "Doing", "Done"). */
    async setState(id: number, state: string): Promise<void> {
      const res = await doFetch(`${base}/workitems/${id}?api-version=7.1`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json-patch+json' },
        body: JSON.stringify(fieldPatch({ 'System.State': state })),
      });
      await json(res);
    },

    /** Post a progress comment (visible on the card). */
    async comment(id: number, text: string): Promise<void> {
      const res = await doFetch(`${base}/workItems/${id}/comments?api-version=7.1-preview.3`, {
        method: 'POST', headers, body: JSON.stringify({ text }),
      });
      await json(res);
    },
  };
}
