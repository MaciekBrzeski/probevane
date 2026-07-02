import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isDirectModel, brainFor } from '../src/brain/select.js';
import { OLLAMA_DEFAULT_MODEL } from '../src/brain/openai-compat.js';

// The `ollama` model token wires the ollama-cloud brain (kimi-k2.7-code default,
// key auto-loaded) as a first-class direct model — routed like local:/openai:.

describe('isDirectModel', () => {
  it('treats ollama tokens as direct (self-primary + self-takeover)', () => {
    expect(isDirectModel('ollama')).toBe(true);
    expect(isDirectModel('ollama:qwen3-coder:480b')).toBe(true);
    expect(isDirectModel('local:qwen2.5-coder:3b')).toBe(true);
    expect(isDirectModel('openai:glm-5.2')).toBe(true);
  });
  it('does not treat routed Anthropic aliases as direct', () => {
    expect(isDirectModel('sonnet')).toBe(false);
    expect(isDirectModel('auto')).toBe(false);
    expect(isDirectModel(undefined)).toBe(false);
  });
});

describe('brainFor(ollama)', () => {
  const KEY = 'PROBEVANE_API_KEY';
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[KEY]; process.env[KEY] = 'test-key'; });
  afterEach(() => { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved; });

  it('defaults the bare `ollama` token to kimi-k2.7-code', () => {
    expect(brainFor('ollama').model).toBe(OLLAMA_DEFAULT_MODEL);
    expect(OLLAMA_DEFAULT_MODEL).toBe('kimi-k2.7-code');
  });
  it('honors an explicit ollama:<id> (colon-bearing ids kept intact)', () => {
    expect(brainFor('ollama:qwen3-coder:480b').model).toBe('qwen3-coder:480b');
  });
});

describe('ollama key resolution', () => {
  const envKeys = ['PROBEVANE_API_KEY', 'OPENAI_API_KEY', 'PROBEVANE_OLLAMA_KEY_FILE'];
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = {}; for (const k of envKeys) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; } });

  it('reads the key file when no env key is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-ollama-'));
    const keyFile = join(dir, 'ollama.key');
    writeFileSync(keyFile, '  file-key-123\n');
    process.env.PROBEVANE_OLLAMA_KEY_FILE = keyFile;
    // Resolves without throwing (key found in the file, trimmed).
    expect(brainFor('ollama').model).toBe(OLLAMA_DEFAULT_MODEL);
  });

  it('throws a clear error when no key is available anywhere', () => {
    process.env.PROBEVANE_OLLAMA_KEY_FILE = join(tmpdir(), 'definitely-missing-ollama-key-xyz');
    expect(() => brainFor('ollama')).toThrow(/no API key/);
  });
});
