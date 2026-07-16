# Vane — the declarative layer

Vane is probevane's tiny declarative language: line-oriented `.vane` files under `vane/` that
declare the parts of the codebase that are pure data-and-composition, leaving TypeScript for
everything that is actually logic. It extends the repo's oldest habit — declarative source →
generated artifact → drift gate (catalog → SKILL.md, TSX → control.html) — into one language
with three declaration kinds.

## Non-goals (read first)

Vane is **not** a general-purpose language and never compiles arbitrary code. Real logic —
probe/detect/run bodies, the loop engine, gates, handlers — stays TypeScript, because the
harness's own brains write TS, every analyzer (ts-morph, quality, module graph, mutation)
reads TS, and debugging must stay in the language the ecosystem understands. Vane grows by
adding **declaration kinds and table entries, never by growing expressions**. Unknown tokens
are positioned errors (`vane/profiles.vane:12: unknown segment 'x'`), not extension points.

## The three declaration kinds

### `command` — the CLI surface (`vane/commands.vane`)

Every probevane command is declared here; this file IS the skill catalog's source of truth
(`catalog.ts` is a loader shim). Data-only entries (summary/usage/example) feed SKILL.md +
wiki generation. Entries with a spec section are **runtime-interpreted**: the shell in
`src/cli/` is a 2-line trampoline, `src/vane/run-command.ts` parses argv from the typed flag
spec and dispatches to a handler in `src/commands/`.

```
command mutation
  summary Full per-site mutation test — …
  usage probevane mutation <dir> [--budget N] …
  example probevane mutation . --budget 60
  dir                          # canonical positional, default '.'
  flag --budget int = 50 "cap mutants"
  flag --json bool
  handler mutation#run         # src/commands/mutation.ts export run(ctx)
```

Flag types: `bool`, `int`, `num`, `str`, `str?` (valued-optional — bare flag parses to `''`),
`list` (comma-split). Handlers receive `CommandCtx {dir, args, flags, argv}`; `ctx.argv` is
the documented escape hatch for parsing the spec can't express (search's positional walk).
22 commands are interpreted; the rest (multi-mode, long-running, flag-forwarding, loop
entrypoints) stay TS by design and keep data-only entries.

### `profile` — rune pipelines (`vane/profiles.vane`)

The top-layer pipeline compositions, generated into `src/loop/profiles.gen.ts`
(`@generated`, committed, byte-drift-gated). The conditional assembly (flag-toggled runes)
stays in `src/loop/profile-subs.ts` — a DSL would only obscure it.

```
profile refactor
  preamble unit
  safety-net behavior_lock
  opt-in unit mfe
  harvest
alias fix = repair
```

Segment tokens resolve against CLOSED tables in `src/vane/gen-profiles.ts`. `@generated`
sources are skipped by the quality analyzer, the module graph, and (through the graph) the
arch pyramid/crowding — generated style is never graded and never counts against caps.

### `adapter` — stack manifests (`vane/adapters/<id>.vane`)

The DATA fields of a StackAdapter (command strings, guidance prose, patterns pointer,
audit-rules ref); `manifestFields(id)` turns one into partial adapter methods the TS adapter
spreads over itself. Partial by design — code fields and dir-dependent commands (python's
.venv resolution) never migrate. Pilot: `go-test`.

## Commands & gates

- `probevane vane` — lint every `.vane` (parse + structural validation, file:line errors).
- `probevane vane --write` — regenerate `profiles.gen.ts` + `docs/wiki/pipeline-model.json`.
- `probevane vane --check` — CI gate: lint + byte-compare both generated artifacts.
- `probevane skill --check` — unchanged: catalog(=vane) ↔ SKILL.md/wiki ↔ bin case list.

A broken `.vane` file hard-throws with file:line at load — never a silent fallback (the
`loadPrompt` silent-`''` bug is the anti-pattern this rule exists to prevent). `vane/` and
`prompts/` ship in the npm package; the loader resolves `$PROBEVANE_ROOT/vane` with a
module-relative fallback that works from both `src/` (tsx dev) and `dist/` (published).
