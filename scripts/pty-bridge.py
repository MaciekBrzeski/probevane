#!/usr/bin/env python3
"""PTY bridge for the control-center terminal (stdlib only — no node-pty).

Node spawns:  python3 pty-bridge.py --cwd DIR --cols N --rows N -- CMD [ARGS...]

  stdin  (Node -> bridge): NDJSON control lines, one per line
    {"t":"d","b":"<base64>"}          decode -> write to the PTY master (keys/paste)
    {"t":"r","c":<cols>,"r":<rows>}   TIOCSWINSZ (kernel delivers SIGWINCH to fg group)
    {"t":"k"} | stdin EOF             SIGHUP the child, then shut down
  stdout (bridge -> Node): raw PTY output bytes, unframed (Node base64s per chunk)
  stderr: diagnostics only

Exits with the child's status (128+signal when signalled).
"""
import argparse
import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_winsize(fd, cols, rows):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def handle_control(line, master, child_pid):
    """Apply one NDJSON control message. Returns False to request shutdown."""
    try:
        msg = json.loads(line)
    except (ValueError, TypeError):
        sys.stderr.write("pty-bridge: bad control line\n")
        return True
    t = msg.get("t")
    if t == "d":
        try:
            os.write(master, base64.b64decode(msg.get("b", "")))
        except OSError:
            return False
    elif t == "r":
        set_winsize(master, int(msg.get("c", 80)), int(msg.get("r", 24)))
    elif t == "k":
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cwd", default=".")
    ap.add_argument("--cols", type=int, default=80)
    ap.add_argument("--rows", type=int, default=24)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    args = ap.parse_args()
    cmd = args.cmd[1:] if args.cmd and args.cmd[0] == "--" else args.cmd
    if not cmd:
        sys.stderr.write("pty-bridge: no command\n")
        return 2

    pid, master = pty.fork()
    if pid == 0:  # child
        try:
            os.chdir(args.cwd)
        except OSError:
            pass
        os.environ.setdefault("TERM", "xterm-256color")
        os.execvp(cmd[0], cmd)
        os._exit(127)  # execvp only returns on failure

    # parent
    set_winsize(master, args.cols, args.rows)
    stdin_fd = sys.stdin.fileno()
    inbuf = b""
    out = sys.stdout.buffer
    running = True
    while running:
        try:
            readable, _, _ = select.select([master, stdin_fd], [], [])
        except select.error:
            break
        for fd in readable:
            if fd == master:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    data = b""
                if not data:  # EOF/EIO — child gone
                    running = False
                    break
                out.write(data)
                out.flush()
            else:  # control channel
                try:
                    chunk = os.read(stdin_fd, 65536)
                except OSError:
                    chunk = b""
                if not chunk:  # Node closed stdin — shut down
                    running = False
                    break
                inbuf += chunk
                while b"\n" in inbuf:
                    line, inbuf = inbuf.split(b"\n", 1)
                    if line and not handle_control(line.decode("utf-8", "replace"), master, pid):
                        running = False
                        break

    try:
        os.kill(pid, signal.SIGHUP)
    except OSError:
        pass
    try:
        _, status = os.waitpid(pid, 0)
    except OSError:
        return 0
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return os.WEXITSTATUS(status)


if __name__ == "__main__":
    sys.exit(main())
