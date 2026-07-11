import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanProject } from './scan.js';

describe('scanProject', () => {
  it('skips .venv / node_modules and analyses Python source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-scan-'));
    try {
      await writeFile(join(dir, 'app.py'), 'def hello(name):\n    return f"hi {name}"\n');
      await mkdir(join(dir, '.venv', 'torch'), { recursive: true });
      // a dependency's bundled JS inside .venv — must NOT be graded
      await writeFile(join(dir, '.venv', 'torch', 'code.js'), 'function x(){ if(1){ return 2 } }\n');
      await mkdir(join(dir, 'node_modules'), { recursive: true });
      await writeFile(join(dir, 'node_modules', 'dep.ts'), 'export const y = 1;\n');
      await writeFile(join(dir, 'test_app.py'), 'def test_hello():\n    assert True\n');

      const report = await scanProject(dir);
      const files = report.files.map((f) => f.file);
      expect(files).toContain('app.py');
      expect(files.some((f) => f.includes('.venv'))).toBe(false);
      expect(files.some((f) => f.includes('node_modules'))).toBe(false);
      expect(files).not.toContain('test_app.py'); // test file excluded
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
