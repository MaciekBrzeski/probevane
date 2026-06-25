import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
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
    },
  },
  {
    name: 'list_dir',
    description: 'List entries of a directory relative to the project dir.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'project-relative dir (default ".")' } },
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
    },
  },
];

export const WRITE_TOOLS = new Set(['write_file', 'edit_file']);

/** Resolve a project-relative path, refusing escapes outside workdir. */
function safePath(ctx: RunCtx, p: string): string {
  if (isAbsolute(p)) throw new Error(`absolute paths are not allowed: ${p}`);
  const abs = resolve(ctx.workdir, p);
  const rel = relative(ctx.workdir, abs);
  if (rel.startsWith('..')) throw new Error(`path escapes project dir: ${p}`);
  return abs;
}

export async function execTool(call: ToolCall, ctx: RunCtx): Promise<string> {
  const input = call.input as any;
  switch (call.name) {
    case 'read_file': {
      const abs = safePath(ctx, input.path);
      const txt = await readFile(abs, 'utf8');
      return txt.length > 20_000 ? txt.slice(0, 20_000) + '\n…[truncated]' : txt;
    }
    case 'list_dir': {
      const abs = safePath(ctx, input.path ?? '.');
      const entries = await readdir(abs, { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? e.name + '/' : e.name)).join('\n');
    }
    case 'write_file': {
      const abs = safePath(ctx, input.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, String(input.contents));
      ctx.editedFiles.add(input.path);
      ctx.lastEditPath = input.path;
      ctx.validatedSinceEdit = false;
      return `wrote ${input.path} (${String(input.contents).length} bytes)`;
    }
    case 'edit_file': {
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
    case 'delete_file': {
      const abs = safePath(ctx, input.path);
      await rm(abs);
      ctx.editedFiles.delete(input.path);
      if (ctx.lastEditPath === input.path) ctx.lastEditPath = null;
      return `deleted ${input.path}`;
    }
    case 'plan': {
      ctx.plan = { text: String(input.plan), at: ctx.step };
      return 'plan recorded';
    }
    default:
      throw new Error(`unknown tool: ${call.name}`);
  }
}

export async function pathExists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false);
}
export { join };
