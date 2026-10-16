---
name: "code-graph"
description: "Use a code graph (code-review-graph, through this skill's cg wrapper) to orient in and search a repository instead of exploring file by file. Covers Rust, GDScript, Python, TypeScript, Go and more. Use at the start of any coding task in a git repository, before a refactor or PR, and when asked about callers, tests, impact or blast radius."
---

# Code graph for Kade

code-review-graph builds a graph of the repository (tree-sitter, no model, no key, no
telemetry) and answers "where is X", "who calls X", "which tests reach X" and "what does
this change reach". Use it before grepping and opening files by hand. This skill runs it
only through its wrapper, `scripts/cg.cjs`, which prints short `path:line name` lines.

## Running it — no install step

Every Bash call that uses it starts with this line, with `<skill dir>` replaced by this
skill's base directory (shown when the skill loads). Shell state does not carry between
Bash calls, so paste it each time:

```bash
cg() { node "<skill dir>/scripts/cg.cjs" "$@"; }
```

- The first call installs the pinned code-review-graph into its own virtual environment,
  `~/.cache/code-review-graph/venv-<version>` (about a minute and 330 MB, once per version).
  It needs Node and Python 3.10 or newer. If either is missing, say so in one line and carry
  on without the graph rather than installing them.
- In a cloud session (Linux x86_64), the first call instead downloads the same version prebuilt
  (about 36 MB, a few seconds), from the `code-graph-<version>-<n>` release in
  `kade-agent/agent-config`, checked against its `SHA256SUMS`. If that fails, `cg` says why in
  one line and installs with pip as above.
- The graph of each repository lives in `~/.cache/code-review-graph/graphs/<repo path>`, so
  nothing is written into the repository and the working tree stays clean.
- Every query updates the graph against the working tree first (about half a second).
- `cg` also indexes `.cjs` as JavaScript, which code-review-graph 2.3.9 skips
  (`EXTRA_EXTENSIONS` in `scripts/cg.cjs`).

## Start of a task

1. `cg build` once: it prints one line. Later calls update incrementally on their own.
2. Then reach for the graph before opening files:
   - `cg search <words>` — ranked definitions matching the words
   - `cg callers <target>` — one line per call site; `cg callees <target>` for what it calls
   - `cg tests <target>` — the tests that reach it
   - `cg skeleton <file>` — every definition in a file with its line span, no bodies

A target is a name (`resume`) or a file and a name (`src/engine.rs::Engine.step`). When a
name has several definitions, `cg` lists them; ask again with the one you mean.
Open the source only when the graph's answer is not enough.

## Reading the output

- `?` after a caller: matched by name only, not through a type or an import. Another function
  of the same name may be the one called (in stella-rain/core, `tests/spike.rs` calls
  `Spike.state_hash`, and is listed under `Engine.state_hash` with a `?`). Check those lines,
  and run the `git grep` line `cg` prints when the answer matters.
- `[test]` marks a test function. `cg tests` lists the tests that call the target, including tests
  matched by name only (marked `?`).
- `shown, <n> omitted` in the first line: code-review-graph shows at most 100 call sites. Run the
  printed `git grep` for the rest; tests among omitted callers are missing from `cg tests`.
- A call through a variable (`session.choose(i)`) can resolve to a same-named function in the
  caller's own file without a `?`. Read the call site when a caller looks unlikely.
- Calls across languages are not tracked: GDScript calling into Rust through gdext, or JS
  calling a Tauri command through `invoke`, shows no callers. `cg` says so and prints the grep.

## Verify in the source

The graph narrows where to look; the source decides.

- Never change code from graph output alone. Read the implementation and its tests before
  any non-trivial change or conclusion.
- Read the exact source whenever the change touches behaviour, persistence or migrations,
  retries and fallbacks, error recovery, or compatibility code.
- When the graph and the source disagree, the source wins: the graph can be stale or not
  model that relationship (macros, reflection, signals connected by name, calls through a
  variable).
- An empty answer means "not indexed or not statically visible", never "does not exist".
  Grep before saying something has no callers or no tests.

## Before a PR or merge request

Run the blast radius against the default branch:

```bash
cg impact            # or: cg impact --base origin/<branch>
```

It prints the blast radius, the risk score with untested changed functions, and the code
reached outside the changed files. For each changed function with a `?` caller or several
definitions, `git grep` its name and add the call sites it finds. Then put this in the PR
description:

```markdown
## Blast radius

- Risk: low / medium / high (cg's risk score, and why if you disagree)
- Reach: <n> files and <m> functions outside the change, by area; "nothing" if none
- Tests: <covered> of <changed> changed functions have a test reaching them
- Missing tests: <function> in <file>, one line each (or why none is needed)
- Found by grep: call sites the graph missed (`?` callers, shared names, other languages)
```

If it reaches areas the change was not meant to touch, raise that with Kade before opening
the PR. This follows `repo-workflow`'s gates and does not replace them.

## Leftover Graft wiring

Kade used Graft before this skill moved to code-review-graph (2026-10). `graft init` leaves
behind: `.claude/skills/graft/`, `.claude/helpers/graft-*.cjs`, Graft hooks, permissions or a
statusline in `.claude/settings.json` or `~/.claude/settings.json`, `~/.claude/helpers/graft-hooks.cjs`,
a `graft` server in `.mcp.json` or `~/.claude.json`, `.ignore`, `graft/` and `/graft/` in `.gitignore`.
Graft hook messages (`[graft] starting points`, `tokens saved`, a 🌱 tally) come from them.
Follow none of it. Say once, in the reply, which files hold it and offer to remove it as a
separate step with its own plan. Never remove or commit it unasked.

## Never

- Never run `code-review-graph install`, `init`, `uninstall`, `mcp`, `serve`, `daemon`,
  `register` or `watch` unless Kade asks. `install` writes MCP config, hooks, skills and
  instructions into `.claude/`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md` and other agents' folders.
- Never run `embed` or pass an embedding provider unless Kade asks in this session: cloud
  providers send code out. Structural builds stay local.
- Never commit `.code-review-graph/` or a graph database. code-review-graph does not belong in
  `AGENTS.md` or `CLAUDE.md` either; this skill carries everything.

## Pinning or updating

- The version is `VERSION` at the top of `scripts/cg.cjs`. To update, change it in a PR to
  `kade-agent/agent-config` with the wrapper tests (`node --test`) and a run on a real
  repository; the next call installs the new version beside the old one. The same PR runs
  `node scripts/code-graph-bundle.cjs lock`; its merge builds the cloud bundle of that version.
  Until that release exists, cloud sessions install with pip.
- When a release maps an extension in `EXTRA_EXTENSIONS` itself, drop that entry in the same PR.
- An old `~/.cache/code-review-graph/venv-<version>` folder can be deleted. A graph built before
  an extension was added misses those files until rebuilt: delete its folder under `graphs/`.
- To check the version in use: `cg version`.
