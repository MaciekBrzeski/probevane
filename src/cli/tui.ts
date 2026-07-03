import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { flag, num } from './args.js';
import { runTui } from './tui-app.js';

// probevane tui [--port N] [--root <stateDir>]
//   The control center IN THE TERMINAL. Auto-launches the daemon if it isn't
//   already up, then renders panes (cost sparkline, rune pipeline light-show,
//   jobs, alerts) with a diff-flushed screen. Keys: q quit · r refresh ·
//   s shell · ↑↓+enter replay a run's light show. Ctrl-C restores the terminal.
const args = process.argv.slice(2);
const PORT = num(args, '--port', Number(process.env.PROBEVANE_DAEMON_PORT ?? 7766));
const ROOT = flag(args, '--root');
const BASE = `http://127.0.0.1:${PORT}`;
const BIN = join(process.env.PROBEVANE_ROOT ?? resolve('.'), 'bin', 'probevane');

async function up(): Promise<boolean> {
  return fetch(`${BASE}/health`, { signal: AbortSignal.timeout(800) }).then((r) => r.ok).catch(() => false);
}

/** Probe /health; spawn a detached daemon and poll until it answers (≤10s). */
async function ensureDaemon(): Promise<boolean> {
  if (await up()) return true;
  process.stderr.write('probevane tui: starting daemon…\n');
  const dargs = ['daemon', '--port', String(PORT), ...(ROOT ? ['--root', ROOT] : [])];
  spawn(BIN, dargs, { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await up()) return true;
  }
  return false;
}

// Terminal lifecycle — alt screen + raw + hidden cursor; restore on any exit.
let restored = false;
function restore(): void {
  if (restored) return;
  restored = true;
  try { process.stdin.setRawMode?.(false); } catch { /* not a tty */ }
  process.stdout.write('\x1b[?25h\x1b[?1049l'); // show cursor, leave alt screen
}

async function main(): Promise<void> {
  if (!(await ensureDaemon())) {
    process.stderr.write(`probevane tui: daemon did not come up on :${PORT}\n`);
    process.exit(1);
  }
  process.stdout.write('\x1b[?1049h\x1b[?25l'); // alt screen, hide cursor
  try { process.stdin.setRawMode?.(true); } catch { /* not a tty */ }
  process.stdin.resume();
  for (const sig of ['SIGINT', 'SIGTERM', 'exit'] as const) process.on(sig, () => { restore(); if (sig !== 'exit') process.exit(0); });
  process.on('uncaughtException', (e) => { restore(); console.error(e); process.exit(1); });
  await runTui(BASE, restore);
  restore();
  process.exit(0);
}

if (!process.env.VITEST) main().catch((e) => { restore(); console.error(String(e)); process.exit(1); });
