// StackAdapter — the modularity contract.
//
// Everything language/framework-specific lives behind this interface. The loop
// (src/loop), the learning library (src/library), the audit core (src/audit),
// and the eval harness (eval/) are all stack-agnostic and talk only to a
// StackAdapter. Adding a new stack = adding one folder under src/adapters/ that
// implements this; nothing else should change.

export type TestKind = 'unit' | 'e2e';
/** Which suites one run() call covers — 'all' folds unit + e2e into a single result. */
export type RunScope = 'unit' | 'e2e' | 'all';

/** A thing we want to write tests for: a component, module, route, or endpoint. */
export interface TestTarget {
  kind: TestKind;
  /** Path to the source file under test (relative to the project dir). */
  sourcePath: string;
  /** Human label, e.g. component or route name. */
  name: string;
  /** Optional extra hints the adapter's probe can fill in. */
  meta?: Record<string, unknown>;
}

/** Ground-truth gathered BEFORE generation. Never let the model guess this. */
export interface ProbeResult {
  target: TestTarget;
  /** Exported symbols / props / DOM roles / routes — whatever the model needs. */
  facts: Record<string, unknown>;
  /** Human-readable digest injected into the generation prompt. */
  digest: string;
  ok: boolean;
  error?: string;
}

/** A test file the loop will write to disk. */
export interface SpecFile {
  /** Path relative to the project dir. */
  path: string;
  contents: string;
}

/** Context handed to *Gen so it can reach few-shot examples + the brain. */
export interface GenCtx {
  projectDir: string;
  /** Few-shot examples already selected by the library, ready to inline. */
  fewShot: string[];
  /** The assembled generation prompt (patterns + anti-patterns + checklist). */
  promptHeader: string;
}

/** Outcome of one suite run, parsed from the runner's own report (not exit codes
 *  alone). Filled by each adapter's run(); the validation gate trusts `green`. */
export interface RunResult {
  passed: number;
  failed: number;
  skipped: number;
  /** True only if the runner exited 0 with >0 tests and 0 failures. */
  green: boolean;
  raw: string;
}

/** Coverage percentages parsed from the stack's report. Filled by coverage();
 *  stacks that report a single total mirror it into the other fields. */
export interface CoverageResult {
  statements: number; // percent 0..100
  branches: number;
  functions: number;
  lines: number;
  ok: boolean;
  raw?: string;
}

/** Shell commands the gates shell out to (validation_gate / acceptance_gate). */
export interface AdapterCommands {
  typecheck: string;
  lint: string;
  testUnit: string;
  testE2e: string;
  coverage: string;
}

/** A language-specific audit rule, fed into src/audit/core.ts. */
export interface AuditRule {
  id: string;
  /** Return a violation message per offending line, or null to pass. */
  check: (line: string, lineNo: number, file: string, full: string) => string | null;
  severity: 'error' | 'warn';
}

/** The per-stack contract (see header). Implemented once per stack under
 *  src/adapters/<stack>/; the registry picks one by detect() score and the
 *  loop/gates call the rest — they never invoke stack tooling directly. */
export interface StackAdapter {
  id: string;

  /** Confidence 0..1 that this adapter owns the project. registry picks the max. */
  detect(dir: string): Promise<number>;

  /** Add test deps + config files. Must be idempotent. */
  install(dir: string): Promise<void>;

  /** Discover targets worth testing (components, routes, modules). */
  discover(dir: string, kind: TestKind): Promise<TestTarget[]>;

  /** Gather ground truth before generation. Failure => a hard plan_first block. */
  probe(dir: string, target: TestTarget): Promise<ProbeResult>;

  /**
   * Optional deterministic/template generators. The default path is
   * LOOP-DRIVEN: the brain writes specs via tools, grounded by probe() digests
   * and context_inject few-shot. These exist for a future scaffold path.
   */
  unitGen?(target: TestTarget, probe: ProbeResult, ctx: GenCtx): Promise<SpecFile[]>;
  e2eGen?(target: TestTarget, probe: ProbeResult, ctx: GenCtx): Promise<SpecFile[]>;

  /** Run the suite. `files` (project-relative) scopes the run to specific specs
   *  — used to validate only the tests just written, ignoring a real app's
   *  pre-existing (possibly env-incompatible) suite. */
  run(dir: string, scope: RunScope, files?: string[]): Promise<RunResult>;
  coverage(dir: string): Promise<CoverageResult>;

  /** Project-relative test files (what counts as a "spec" is stack-specific). */
  specFiles(dir: string): Promise<string[]>;

  /** Framework + placement instructions injected into the generation task. */
  guidance(kind: TestKind): string;

  /** Stack-specific test patterns (few-shot) injected by context_inject. */
  patternsDoc(kind: TestKind): Promise<string>;

  auditRules(): AuditRule[];
  /** `dir` lets a stack resolve project-local toolchains (e.g. a python .venv). */
  commands(dir: string): AdapterCommands;
}
