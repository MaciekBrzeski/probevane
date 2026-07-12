import { spawn } from 'node:child_process';
import type { FnMetric } from './analyze.js';

// Python source-quality metrics — the Python counterpart to the ts-morph detector in
// analyze-detect.ts. The quality analyzer is otherwise language-agnostic (line-based
// size/imports/debt/duplication); only per-function complexity needs a parser. Rather
// than bundle a Python parser for Node, we shell the target's `python3` with an embedded
// `ast` script (stdlib only — no deps) that emits the SAME FnMetric shape.

// Reads {file: source} JSON on stdin, prints {file: FnMetric[]} JSON on stdout. Cognitive
// complexity mirrors analyze-detect: each branch costs 1 + its nesting depth; a && / ||
// (BoolOp) counts once per operand pair. Nested functions are measured on their own.
const PY = String.raw`
import sys, json, ast

FUNC = (ast.FunctionDef, ast.AsyncFunctionDef)
BRANCH = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.IfExp)
NEST = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.With, ast.AsyncWith, ast.Try)
MATCH_CASE = getattr(ast, "match_case", ())

def is_branch(n):
    return isinstance(n, BRANCH) or isinstance(n, ast.BoolOp) or (MATCH_CASE and isinstance(n, MATCH_CASE))

def weight(n):
    return (len(n.values) - 1) if isinstance(n, ast.BoolOp) else 1

def measure(fn):
    br = cog = nest = 0
    def visit(node, depth):
        nonlocal br, cog, nest
        for c in ast.iter_child_nodes(node):
            if isinstance(c, FUNC):
                continue  # nested function measured separately
            if is_branch(c):
                w = weight(c)
                br += w
                cog += w * (1 + depth)
            deep = isinstance(c, NEST) or (MATCH_CASE and isinstance(c, MATCH_CASE))
            if deep:
                nest = max(nest, depth + 1)
            visit(c, depth + 1 if deep else depth)
    visit(ast.Module(body=list(fn.body), type_ignores=[]), 0)
    return br, cog, nest

def params(fn):
    a = fn.args
    return (len(a.posonlyargs) + len(a.args) + len(a.kwonlyargs)
            + (1 if a.vararg else 0) + (1 if a.kwarg else 0))

def funcs(src):
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return []
    out = []
    for node in ast.walk(tree):
        if isinstance(node, FUNC):
            br, cog, nest = measure(node)
            end = getattr(node, "end_lineno", node.lineno)
            out.append(dict(name=node.name, startLine=node.lineno, endLine=end,
                            loc=end - node.lineno + 1, params=params(node),
                            complexity=br + 1, cognitive=cog, nesting=nest))
    return out

data = json.load(sys.stdin)
print(json.dumps({f: funcs(s) for f, s in data.items()}))
`;

const PY_CANDIDATES = [process.env.PROBEVANE_PYTHON, 'python3', 'python'].filter(Boolean) as string[];

/** Run the embedded analyzer script under `py`, feeding `input` on stdin.
 *  Rejects on spawn failure or non-zero exit so the caller can fall through
 *  to the next interpreter candidate. */
function runPython(py: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(py, ['-c', PY], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || `python exit ${code}`)),
    );
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Per-function metrics for Python sources, keyed by file. Returns null if no Python
 * interpreter is available (the caller then skips Python quality rather than failing).
 */
export async function detectPythonFunctions(
  sources: { file: string; source: string }[],
): Promise<Map<string, FnMetric[]> | null> {
  if (!sources.length) return new Map();
  const payload = JSON.stringify(Object.fromEntries(sources.map((s) => [s.file, s.source])));
  for (const py of PY_CANDIDATES) {
    try {
      const raw = await runPython(py, payload);
      return new Map(Object.entries(JSON.parse(raw) as Record<string, FnMetric[]>));
    } catch {
      // try the next interpreter
    }
  }
  return null; // no usable python3 — Python files skipped, not fatal
}
