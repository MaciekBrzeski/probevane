// Generated-file detection — the quality analyzer and the module graph skip
// sources carrying this first-line marker (a generated profiles.gen.ts must
// not be graded, graphed, or counted against folder-crowding caps).

/** True when the source's first line declares it machine-generated. */
export function isGeneratedSource(source: string): boolean {
  const firstLine = source.slice(0, source.indexOf('\n') + 1 || source.length);
  return firstLine.includes('@generated');
}
