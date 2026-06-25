import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Load a prompt file from prompts/. Empty string if missing. */
export async function loadPrompt(name: string): Promise<string> {
  return readFile(join(ROOT, 'prompts', name), 'utf8').catch(() => '');
}
