// Wire shape of the /checks gate scoreboard — a pure-type leaf so the daemon
// collector (node side) and the control-center tab (DOM side) share one
// definition without the UI tsconfig swallowing node imports.

/** Everything the Checks tab renders in one payload. Built by collectChecks;
 *  nulls mean "no artifact on disk", never "passed". */
export interface ChecksReport {
  quality: { grade: number; errors: number; warns: number; files: number; functions: number; docBacklog: number };
  pyramid: { score: number; violations: number; features: number; glue: number; shared: number };
  crowding: { dir: string; files: number }[];
  cycles: number;
  coverage: { statements: number; branches: number; functions: number; lines: number } | null;
  evalHistory: { label: string; ratio: number }[]; // improvement-log tail, oldest first
}
