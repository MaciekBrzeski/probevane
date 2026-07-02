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
    // detached → own process GROUP, so the timeout can kill the whole tree.
    // Killing only bash orphans its grandchildren (vitest/pytest workers keep
    // the stdio pipes open → `close` never fires → this promise hangs forever
    // while the orphans spin). Bit for real: a mutant-induced infinite loop
    // outlived the 3-minute timeout by hours.
    const child = spawn('bash', ['-lc', cmd], { cwd, env: process.env, detached: true });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (code: number, extraErr = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr: stderr + extraErr, ok: code === 0 });
    };
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL'); // whole group
      } catch {
        child.kill('SIGKILL');
      }
      // Belt + braces: resolve even if a survivor still holds the pipes open.
      setTimeout(() => finish(124, `\nprobevane: killed after ${timeoutMs}ms timeout`), 2_000);
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => finish(code ?? 1));
    child.on('error', (err) => finish(1, String(err)));
  });
}
