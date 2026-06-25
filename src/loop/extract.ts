// Text-extract fallback — lets a NON-tool-calling local model contribute. Weak
// coder models (qwen2.5-coder, the mk-coder LoRAs) emit the test as a fenced code
// block in plain text instead of calling write_file. This parses that block so
// the engine can synthesize the write — flipping those models from useless to
// usable. Pure + testable.

const TESTY = /\b(expect|assert|describe|\bit\(|test\(|t\.(Run|Errorf|Fatalf)|pytest|#\[test\])/;

/** Extract a project path the model named near/in the code (fence info, leading comment, or "File:" line). */
function findPath(infoLine: string, code: string, pre: string): string | undefined {
  // 1. Fence info string: ```ts src/x.test.ts  OR  ```ts title="src/x.test.ts"
  const info = infoLine.match(/(?:title=)?["']?([\w./-]+\.(?:tsx?|jsx?|py|go|rs))["']?/);
  if (info) return info[1];
  // 2. Leading comment inside the block: // src/x.test.ts  or  # test_x.py
  const lead = code.match(/^\s*(?:\/\/|#)\s*([\w./-]+\.(?:tsx?|jsx?|py|go|rs))\s*$/m);
  if (lead) return lead[1];
  // 3. A "File:" / "path:" mention or a backticked path in the prose just before the fence.
  const pra = pre.match(/(?:file|path)\s*[:=]\s*`?([\w./-]+\.(?:tsx?|jsx?|py|go|rs))`?/i)
    ?? pre.match(/`([\w./-]+\.(?:tsx?|jsx?|py|go|rs))`/);
  return pra?.[1];
}

export interface Extracted {
  path?: string;
  code: string;
}

/**
 * Pull the largest test-like fenced code block out of a model's prose answer.
 * Returns null when there's no fenced block or it isn't test-like.
 */
export function extractTestBlock(text: string): Extracted | null {
  if (!text) return null;
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let best: { info: string; code: string; start: number } | null = null;
  while ((m = fence.exec(text))) {
    const code = m[2];
    if (!TESTY.test(code)) continue;
    if (!best || code.length > best.code.length) best = { info: m[1].trim(), code, start: m.index };
  }
  if (!best) return null;
  const pre = text.slice(Math.max(0, best.start - 200), best.start);
  const path = findPath(best.info, best.code, pre);
  return { path, code: best.code.trimEnd() + '\n' };
}

/** Best-effort conventional spec path for a source file, by adapter id (fallback hint). */
export function conventionalSpecPath(adapterId: string, sourcePath: string): string {
  const dot = sourcePath.lastIndexOf('.');
  const stem = dot > 0 ? sourcePath.slice(0, dot) : sourcePath;
  const ext = dot > 0 ? sourcePath.slice(dot + 1) : '';
  const base = sourcePath.split('/').pop()!.replace(/\.[^.]+$/, '');
  const dir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
  if (adapterId.startsWith('python')) return `${dir}test_${base}.py`;
  if (adapterId.startsWith('go')) return `${stem}_test.go`;
  if (adapterId.startsWith('rust')) return `tests/${base}.rs`;
  if (adapterId.startsWith('angular')) return `${stem}.spec.ts`;
  // vitest-family (react/vue/svelte/node): sibling .test.<ts|tsx>
  return `${stem}.test.${ext === 'tsx' ? 'tsx' : 'ts'}`;
}
