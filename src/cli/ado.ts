import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { adoClient, triggerWiql, parseDirective, summarize, type AdoConfig, type AdoDirective } from '../integrations/ado.js';

/** PAT from env, else a gitignored file (so secrets never land in shell history/chat). */
function resolvePat(): string {
  if (process.env.AZURE_DEVOPS_PAT) return process.env.AZURE_DEVOPS_PAT;
  try {
    return readFileSync(join(homedir(), '.config', 'probevane', 'ado.pat'), 'utf8').trim();
  } catch {
    return '';
  }
}

// probevane ado <run|create> — Azure DevOps board integration.
//   run     poll the board for tagged work items, run the loop per item, and
//           report progress back as state moves + comments (observable on the board).
//   create  create a work item describing a probevane task (to launch a loop).
//
// Auth/config: AZURE_DEVOPS_PAT (required), AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT
// (or --org/--project). Board states default to the Basic process (To Do/Doing/Done).

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function runCli(directive: AdoDirective): Promise<{ ok: boolean; out: string }> {
  const args: string[] = [directive.command, directive.dir, '--kind', directive.kind];
  if (directive.only) args.push('--only', directive.only);
  if (directive.task) args.push('--task', directive.task);
  const bin = new URL('../../bin/probevane', import.meta.url).pathname;
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024, timeout: 1_200_000 }, (err, stdout, stderr) => {
      const out = (stdout || '') + (stderr || '');
      const ok = /\bACCEPTED\b/.test(out) && !/NOT ACCEPTED/.test(out);
      resolve({ ok: !err && ok, out });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const sub = args[0];
  const cfg: AdoConfig = {
    org: flag(args, '--org') ?? process.env.AZURE_DEVOPS_ORG ?? 'maciejbrzeski',
    project: flag(args, '--project') ?? process.env.AZURE_DEVOPS_PROJECT ?? 'probevane',
    pat: resolvePat(),
  };
  if (!cfg.pat) {
    console.error('[ado] no PAT. Set AZURE_DEVOPS_PAT or write it to ~/.config/probevane/ado.pat (Work Items: Read & Write). Token: https://dev.azure.com/' + cfg.org + '/_usersSettings/tokens');
    process.exit(2);
  }
  const client = adoClient(cfg);
  const tag = flag(args, '--tag') ?? 'probevane';
  const todo = flag(args, '--todo-state') ?? 'To Do';
  const active = flag(args, '--active-state') ?? 'Doing';
  const done = flag(args, '--done-state') ?? 'Done';

  if (sub === 'create') {
    const type = flag(args, '--type') ?? 'Issue';
    const title = flag(args, '--title') ?? '[probevane] generate . --kind unit';
    const desc = flag(args, '--desc') ?? title;
    const id = await client.create(type, { 'System.Title': title, 'System.Tags': tag, 'System.Description': desc });
    console.log(`[ado] created work item #${id}: ${title}`);
    console.log(`      https://dev.azure.com/${cfg.org}/${cfg.project}/_workitems/edit/${id}`);
    return;
  }

  if (sub === 'attach') {
    // probevane ado attach <id> <file...> [--comment "label"]
    const id = Number(args[1]);
    const files = args.slice(2).filter((a) => !a.startsWith('--') && a !== String(id));
    if (!id || !files.length) { console.error('usage: probevane ado attach <id> <file...>'); process.exit(2); }
    for (const f of files) {
      const { url } = await client.attach(basename(f), new Uint8Array(readFileSync(f)));
      await client.linkAttachment(id, url, flag(args, '--comment') ?? basename(f));
      console.log(`[ado] #${id}: attached ${basename(f)}`);
    }
    return;
  }

  if (sub === 'qa') {
    // probevane ado qa <id> --text "<natural-language QA summary>" [--comment]
    // Appends a human-readable QA section to the work item's Description (and optionally
    // posts it as a comment) — so the board documents what the change actually does.
    const id = Number(args[1]);
    const text = flag(args, '--text') ?? '';
    if (!id || !text) { console.error('usage: probevane ado qa <id> --text "<summary>"'); process.exit(2); }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cur = await client.describe(id);
    const html = `${cur}<hr/><p><b>🧪 QA summary</b></p><div>${esc(text).replace(/\n/g, '<br/>')}</div>`;
    await client.update(id, { 'System.Description': html });
    if (args.includes('--comment')) await client.comment(id, '🧪 QA: ' + text);
    console.log(`[ado] #${id}: description enhanced with QA summary`);
    return;
  }

  if (sub !== 'run') {
    console.error('usage: probevane ado <run|create|attach|qa> [--project P] [--tag probevane] [--once]');
    process.exit(2);
  }

  // Poll the board for trigger work items and process each.
  const ids = await client.query(triggerWiql(tag, todo));
  const items = await client.getMany(ids);
  console.log(`[ado] ${items.length} '${tag}' work item(s) in '${todo}'`);
  for (const wi of items) {
    const d = parseDirective(wi.title, wi.description);
    if (!d) {
      await client.comment(wi.id, '⚠️ probevane: no directive found (expected e.g. "generate <dir> --kind unit").');
      continue;
    }
    console.log(`[ado] #${wi.id}: ${d.command} ${d.dir} (${d.kind})`);
    await client.setState(wi.id, active);
    await client.comment(wi.id, `🔧 probevane started: \`${d.command} ${d.dir} --kind ${d.kind}${d.only ? ' --only ' + d.only : ''}\``);
    const { ok, out } = await runCli(d);
    await client.comment(wi.id, `${ok ? '✅' : '❌'} ${summarize(out)}`);
    await client.setState(wi.id, ok ? done : todo);
    console.log(`[ado] #${wi.id}: ${ok ? 'DONE' : 'returned to ' + todo}`);
  }
}

main().catch((e) => { console.error('[ado] error:', e.message); process.exit(1); });
