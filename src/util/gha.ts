import { appendFile } from 'node:fs/promises';

// GitHub Actions output helper — consolidated from identical copies in the ci
// and review CLIs (surfaced by `search --similar --fns`).

/** Print markdown and mirror it to $GITHUB_STEP_SUMMARY when running in Actions. */
export async function emitSummary(md: string): Promise<void> {
  console.log(md);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, md + '\n').catch(() => {});
}
