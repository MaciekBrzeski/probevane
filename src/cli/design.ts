import { resolve } from 'node:path';
import { designLoop, type DesignPage } from '../visual/design.js';

// probevane design --url <u> --target <file> [--tabs a,b,c] [--goal "<g>"] [--rounds N] [--spec <file>] [--out <dir>]
//
// Combined design loop: write a Playwright screenshot spec for each page/tab, run
// it, a vision model judges each shot for design practice, then rewrites the
// target file's <style> to address the findings — re-capture and repeat.
//
// $0 vision: PROBEVANE_VISION_BASE=https://ollama.com/v1 + PROBEVANE_VISION_MODEL=minimax-m3
// (key from PROBEVANE_VISION_KEY / the ollama key file). Needs chromium.
async function main() {
  const a = process.argv.slice(2);
  const url = flag('--url');
  const targetFile = flag('--target');
  if (!url || !targetFile) {
    console.error('usage: probevane design --url <u> --target <file> [--tabs a,b,c] [--goal "<g>"] [--rounds N] [--spec <file>] [--out <dir>]');
    process.exit(2);
    return;
  }
  // Tabs → clickable pages (control-center nav). No --tabs = one full-page shot.
  const tabs = (flag('--tabs') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const pages: DesignPage[] = tabs.length
    ? tabs.map((t) => ({ name: t, clicks: [`nav.tabs button[data-go="${t}"]`] }))
    : [{ name: 'page' }];

  const res = await designLoop({
    url,
    targetFile: resolve(targetFile),
    pages,
    goal: flag('--goal') ?? 'improve the visual design toward modern, legible, well-spaced UI',
    outDir: resolve(flag('--out') ?? '.probevane/design'),
    specFile: flag('--spec') ? resolve(flag('--spec')!) : undefined,
    rounds: parseInt(flag('--rounds') ?? '2', 10),
    width: flag('--width') ? parseInt(flag('--width')!, 10) : undefined,
    log: (l) => console.error(l),
  });
  const edits = res.rounds.filter((r) => r.edited).length;
  console.log(`[probevane] design: ${edits} edit round(s) over ${res.rounds.length} · ${res.shots.length} shot(s) in ${resolve(flag('--out') ?? '.probevane/design')}`);

  function flag(name: string): string | undefined {
    const i = a.indexOf(name);
    return i >= 0 ? a[i + 1] : undefined;
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
