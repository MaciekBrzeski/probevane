import { describe, it, expect } from 'vitest';
import { positionals } from './args.js';

describe('positionals', () => {
  it('collects non-flag args, skipping the value after each value-flag', () => {
    const argv = ['add tests', './app', '--model', 'sonnet', '--interactive', '--root', '/s'];
    expect(positionals(argv, ['--model', '--root', '--answers'])).toEqual(['add tests', './app']);
  });
  it('keeps a positional that merely follows a boolean flag', () => {
    expect(positionals(['--strict', 'prompt', 'dir'], ['--model'])).toEqual(['prompt', 'dir']);
  });
  it('returns [] for an all-flag argv', () => {
    expect(positionals(['--json', '--dry-run'], [])).toEqual([]);
  });
});
