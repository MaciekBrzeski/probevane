import { spawn } from 'node:child_process';

// Cap large text entering the transcript: keep the head + tail (where the
// signal usually is — first error, final summary) and elide the middle. Keeps
// per-turn input tokens bounded on noisy command output (runestone's bash cap).
export function capOutput(s: string, headLines = 40, tailLines = 60): string {
  const lines = s.split('\n');
  if (lines.length <= headLines + tailLines) return s;
  const head = lines.slice(0, headLines).join('\n');
  const tail = lines.slice(-tailLines).join('\n');
  const elided = lines.length - headLines - tailLines;
  return `${head}\n… [${elided} lines elided] …\n${tail}`;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  ok: boolean;
}

/** Run a shell command in `cwd`, capturing output. Never throws on non-zero. */
export function sh(cmd: string, cwd: string, timeoutMs = 180_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', cmd], { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      const c = code ?? 1;
      resolve({ code: c, stdout, stderr, ok: c === 0 });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr + String(err), ok: false });
    });
  });
}
