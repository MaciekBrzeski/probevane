import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { runPathCliMain } from './path-cli.js';
import { flag } from './args.js';
import { changedFiles, isSourceFile, specCandidatesFor } from '../git.js';

// probevane repair <dir> [--since <ref>] [--model …]
//
// After source changes, update the affected tests so the suite is green again.
// Uses git to find changed source → their sibling specs; the model updates those
// specs to match the new behavior (whole suite must end green).
runPathCliMain(
  'repair',
  async (args, dir, _cfg, getAdapter) => {
    const since = flag(args, '--since') ?? 'HEAD';
    const adapter = await getAdapter();
    const changed = (await changedFiles(dir, since)).filter(isSourceFile);
    if (changed.length === 0) {
      console.log('[probevane] no changed source files — nothing to repair');
      return null;
    }

    // Map changed source → existing sibling specs.
    const pairs: { source: string; specs: string[] }[] = [];
    for (const source of changed) {
      const specs: string[] = [];
      for (const cand of specCandidatesFor(source))
        if (await access(join(dir, cand)).then(() => true).catch(() => false)) specs.push(cand);
      pairs.push({ source, specs });
    }
    const withSpecs = pairs.filter((p) => p.specs.length);
    console.error(`[probevane] repair adapter=${adapter.id}; ${changed.length} changed source file(s), ${withSpecs.length} with tests`);

    return [
      `These source files changed; their tests may now be stale. Update ONLY the affected test files`,
      `so the whole suite passes again, matching the NEW behavior. Read the changed source first.`,
      `Do not change source. Do not weaken assertions to force a pass — reflect the real new behavior.`,
      ``,
      `Changed source → tests to repair:`,
      ...pairs.map((p) => `- ${p.source}${p.specs.length ? ` → ${p.specs.join(', ')}` : ' (no test found — add one if the behavior is now untested)'}`),
    ].join('\n');
  },
  { cacheRead: true },
);
