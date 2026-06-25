# Projects

This section holds **per-project specifications** — one page per codebase probevane has analyzed. Each is generated from the project's real structure: the module dependency graph (rendered as a diagram), every module's responsibility and exports, the network/API surface, and test coverage.

## Publish a project page

```bash
probevane spec <project-dir> --narrate --wiki
```

That writes `docs/wiki/project-<name>.md`, which appears automatically under **Projects** in the sidebar (diagrams render inline). Drop `--narrate` for a faster, LLM-free spec.

A spec can also be produced as part of a generation run:

```bash
probevane generate <project-dir> --kind unit --spec --narrate
```

## What's in a project page

- **Overview** — module/endpoint counts + coverage.
- **Module graph** — ASCII tree + a Mermaid diagram of the import chain (the order the [mock maker](Mock-Maker.md) walks).
- **Modules** — leaf-first: each module's kind, dependencies, exports/probe facts, and (with `--narrate`) a one-line description.
- **API surface** — the synthesized network endpoints.

See the published examples in the sidebar (e.g. **react shop**).
