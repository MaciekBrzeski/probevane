import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute, parse as parsePath } from 'node:path';
import type { RunCtx } from './ctx.js';
import type { ToolCall, ToolSpec } from './types.js';

// The tool surface the brain can call. Kept deliberately small: read, list,
// write, edit, plan. Tests are run by the validation_gate (shouldStop), not by
// a tool the model can game.

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file relative to the project dir.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'project-relative path' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_dir',
    description: 'List entries of a directory relative to the project dir.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'project-relative dir (use "." for root)' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file (project-relative). Use for new test files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        contents: { type: 'string' },
      },
      required: ['path', 'contents'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_file',
    description: 'Replace the first exact occurrence of old_string with new_string in a file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_file',
    description:
      'Delete a file (project-relative). Use to remove leftover/empty/placeholder test files you no longer need.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'plan',
    description:
      'Record your test plan BEFORE writing tests: which targets, what behaviors, expected assertions. Required once before any write_file/edit_file.',
    inputSchema: {
      type: 'object',
      properties: { plan: { type: 'string', description: 'the test plan' } },
      required: ['plan'],
      additionalProperties: false,
    },
  },
];

export const WRITE_TOOLS = new Set(['write_file', 'edit_file']);

/** Resolve a project-relative WRITE path, refusing escapes outside the workdir. */
function safePath(ctx: RunCtx, p: string): string {
  if (isAbsolute(p)) throw new Error(`absolute paths are not allowed: ${p}`);
  const abs = resolve(ctx.workdir, p);
  const rel = relative(ctx.workdir, abs);
  if (rel.startsWith('..')) throw new Error(`path escapes project dir: ${p}`);
  return abs;
}

/** The workspace/repo root containing `workdir` — first ancestor with a
 *  pnpm-workspace.yaml, a package.json with `"workspaces"`, or `.git`. Falls
 *  back to `workdir` itself (no widening for a non-workspace/non-repo dir).
 *  Pure (path in → path out); reused by the dependency-API digest. */
/** True if `pkg` (a package.json path) declares a `workspaces` field. */
function hasWorkspacesField(pkg: string): boolean {
  if (!existsSync(pkg)) return false;
  try {
    return 'workspaces' in JSON.parse(readFileSync(pkg, 'utf8'));
  } catch {
    return false; // unparseable — not a workspace root
  }
}

/** A directory is a workspace/repo root if it has a pnpm-workspace, a .git, or a
 *  package.json with a `workspaces` field. */
function isRepoRoot(dir: string): boolean {
  return (
    existsSync(join(dir, 'pnpm-workspace.yaml')) ||
    existsSync(join(dir, '.git')) ||
    hasWorkspacesField(join(dir, 'package.json'))
  );
}

/** Nearest ancestor that looks like a workspace/repo root (bounded walk); falls back
 *  to the workdir itself when no marker is found. */
export function workspaceRootOf(workdir: string): string {
  let dir = workdir;
  const fsRoot = parsePath(dir).root;
  for (let i = 0; i < 12; i++) {
    if (isRepoRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir || dir === fsRoot) break; // no marker → fall back to workdir
    dir = parent;
  }
  return workdir;
}

/** Memoized-on-ctx workspace root. Reads are allowed anywhere under it; writes are not. */
function workspaceRoot(ctx: RunCtx): string {
  return (ctx.workspaceRoot ??= workspaceRootOf(ctx.workdir));
}

/** Resolve a READ path. Allowed under the workdir (always) or anywhere under the
 *  workspace/repo root (excluding `.git`) — so a sandboxed run can read sibling
 *  workspace packages' source/types. Never permits absolute paths. */
function safeReadPath(ctx: RunCtx, p: string): string {
  if (isAbsolute(p)) throw new Error(`absolute paths are not allowed: ${p}`);
  const abs = resolve(ctx.workdir, p);
  if (!relative(ctx.workdir, abs).startsWith('..')) return abs; // inside workdir
  const root = workspaceRoot(ctx);
  const relRoot = relative(root, abs);
  if (!relRoot.startsWith('..') && !relRoot.split(/[/\\]/).includes('.git')) return abs; // inside workspace
  throw new Error(
    `${p} is outside the workspace — you don't need it. Use the modules you already import, ` +
      `or read a path within the project/workspace.`,
  );
}

// --- per-tool handlers (1:1 with the dispatch cases in execTool) ---

async function readFileTool(ctx: RunCtx, input: any): Promise<string> {
  ctx.reads++;
  const abs = safeReadPath(ctx, input.path);
  const txt = await readFile(abs, 'utf8');
  return txt.length > 20_000 ? txt.slice(0, 20_000) + '\n…[truncated]' : txt;
}

/** List a directory (workspace-scoped read); a trailing / marks subdirs. */
async function listDirTool(ctx: RunCtx, input: any): Promise<string> {
  ctx.reads++;
  const abs = safeReadPath(ctx, input.path ?? '.');
  const entries = await readdir(abs, { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? e.name + '/' : e.name)).join('\n');
}

/** Create/overwrite a file inside the workdir, tracking it as this run's edit. */
async function writeFileTool(ctx: RunCtx, input: any): Promise<string> {
  const abs = safePath(ctx, input.path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, String(input.contents));
  ctx.editedFiles.add(input.path);
  ctx.lastEditPath = input.path;
  ctx.validatedSinceEdit = false;
  return `wrote ${input.path} (${String(input.contents).length} bytes)`;
}

/** Replace ONE occurrence of old_string — must be found AND unique, else a hard
 *  error the model can act on (add more context). */
async function editFileTool(ctx: RunCtx, input: any): Promise<string> {
  const abs = safePath(ctx, input.path);
  const cur = await readFile(abs, 'utf8');
  const idx = cur.indexOf(input.old_string);
  if (idx === -1) throw new Error(`old_string not found in ${input.path}`);
  if (cur.indexOf(input.old_string, idx + 1) !== -1)
    throw new Error(`old_string is not unique in ${input.path} — add more context`);
  const next = cur.slice(0, idx) + input.new_string + cur.slice(idx + input.old_string.length);
  await writeFile(abs, next);
  ctx.editedFiles.add(input.path);
  ctx.lastEditPath = input.path;
  ctx.validatedSinceEdit = false;
  return `edited ${input.path}`;
}

/** Delete a file and untrack it from the run's edits. */
async function deleteFileTool(ctx: RunCtx, input: any): Promise<string> {
  const abs = safePath(ctx, input.path);
  await rm(abs);
  ctx.editedFiles.delete(input.path);
  if (ctx.lastEditPath === input.path) ctx.lastEditPath = null;
  return `deleted ${input.path}`;
}

/** Record the plan on ctx — plan_first gates writes on its presence. */
function planTool(ctx: RunCtx, input: any): string {
  ctx.plan = { text: String(input.plan), at: ctx.step };
  return 'plan recorded';
}

/** Tool dispatch — the single place a ToolCall becomes a real filesystem/plan action. */
export async function execTool(call: ToolCall, ctx: RunCtx): Promise<string> {
  const input = call.input as any;
  switch (call.name) {
    case 'read_file':
      return readFileTool(ctx, input);
    case 'list_dir':
      return listDirTool(ctx, input);
    case 'write_file':
      return writeFileTool(ctx, input);
    case 'edit_file':
      return editFileTool(ctx, input);
    case 'delete_file':
      return deleteFileTool(ctx, input);
    case 'plan':
      return planTool(ctx, input);
    default:
      throw new Error(`unknown tool: ${call.name}`);
  }
}

/** stat-based existence check that never throws. */
export async function pathExists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false);
}
export { join };
