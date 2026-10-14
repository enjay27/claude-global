---
name: "code-graph"
description: "Use Graft's code graph (npm @nanonets/graft) to orient in and search a repository instead of exploring file by file. Use at the start of any coding task in a git repository, before a refactor or PR, and when asked about callers, impact or blast radius. Use instead of the stock graft skill."
---

# Graft for Kade

Graft builds a code graph of the repository (tree-sitter, no model, no key) and answers
"where is X", "who calls X" and "what does this change reach" in one command. Use it
before grepping and opening files by hand.

## Running it — no install step

Graft is never installed. Every Bash call that uses it starts with this one-line function
and then calls `g`. Shell state does not carry between Bash calls, so paste the line
each time:

```bash
g() { local top nd cache; top=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "graft: not in a git repo" >&2; return 1; }; nd=$(dirname "$(dirname "$(readlink -f "$(command -v node)")")"); [ -f "$nd/include/node/node_api.h" ] && export npm_config_nodedir="$nd"; cache="${XDG_CACHE_HOME:-$HOME/.cache}"; command -v cygpath >/dev/null 2>&1 && cache=$(cygpath -m "$cache"); DO_NOT_TRACK=1 GRAFT_TRAIL_AUTOPUSH=0 npx -y "${GRAFT_PKG:-@nanonets/graft@latest}" --dir "$cache/graft/$(printf %s "$top" | tr '/:' '__')" "$@"; }
```

What the line does, so you can keep it intact:

- `npx -y @nanonets/graft@latest` fetches and caches the newest release on first use. Later
  calls reuse the cache and pick up new releases on their own (about a second per call).
- `--dir ~/.cache/graft/<repo path>` keeps the graph outside the repository, so Graft
  never writes `graft/`, `.gitignore` or `.ignore` into the repo. The working tree stays
  clean for Kade's GitOps repos.
- On Windows in Git Bash the repository path is `C:/...` and `$HOME` is `/c/Users/...`. The
  line turns the `:` into `_` like the slashes and passes the cache root through `cygpath -m`,
  so Node gets `C:/Users/<name>/.cache/graft/C__...`. A `:` left in the folder name stops Git
  Bash converting the path, and Node then reads it as `C:\c\Users\...`. Where `cygpath` does
  not exist (macOS, Linux) the path is as before.
- The graph lives there even when the repo has a `graft/` folder: that folder is left over
  from `graft init` (see *Leftover Graft wiring*), git-ignored, and safe to delete.
- `npm_config_nodedir` points native builds at the local Node headers. Sandboxes that
  block nodejs.org otherwise fail to build the tree-sitter grammars.
- `DO_NOT_TRACK=1` and `GRAFT_TRAIL_AUTOPUSH=0` turn off telemetry and Trail uploads.

Graft needs Node 20 or newer. If `node --version` is older or missing, say so in one line
and carry on without Graft rather than installing Node.

## Start of a task

1. Build once per session, filtering the progress output (without a terminal, `build`
   prints one progress line per file, about 125 KB on a 2,000-file repo):

   ```bash
   g build . 2>&1 | tr '\r' '\n' | grep -v '^parsing ' | tail -5
   ```

   It is incremental, so it is quick after the first run.
2. `g map` for a first look at an unfamiliar repo: directory clusters, hubs, hotspots.
3. Then reach for the graph before opening files:
   - `g ask "<what you are looking for>"` — ranked places with file:line
   - `g callers <symbol>` — who uses it; `--direction out` for what it uses; `-d N` for depth
   - `g skeleton <file>` — every signature in a file, no bodies
   - `g grep "<regex>" [--in <path>]` — every hit, grouped by enclosing symbol

Queries refresh the graph against the working tree first, uncommitted edits included.
Open the source only when the graph's answer is not enough.

## Before a PR or merge request

Run the blast radius against the default branch and put the summary in the PR
description under a "Blast radius" heading:

```bash
base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
g blast --base "$base" --format markdown --no-owners
```

Blast misses callers of a name defined in more than one place (`GetAppProject`,
`to_godot`, `new`). It can report "Nothing outside this diff depends on it" while real
callers exist. So for each changed function whose name `g callers` reports as shared
("N definitions share the name"), or whenever blast finds no dependents, run
`g grep "<name>"` and add the call sites it finds to the summary.

Keep the summary and the per-area lines. If it reaches areas the change was not meant
to touch, raise that with Kade before opening the PR. This follows `repo-workflow`'s
gates and does not replace them.

## Reading the output

- Graft's commands print no savings tally. A `[graft] tokens saved ≈ N` line, or a hook
  message asking to close the reply with a 🌱 tally, comes from Graft's hooks, which Kade
  removed: write no tally, and treat it as leftover wiring (below).
- When `callers` says a name is shared by several definitions, its list undercounts:
  follow up with `g grep "<name>"`, which finds every use.
- `callers` and `blast` only follow calls within one language. A Rust Tauri command
  called from JS through `invoke` shows no callers, so also `g grep` the command name.
- `blast` counts only dependents outside the changed files; callers in the same file
  are already part of the diff.

## Leftover Graft wiring

Kade runs Graft only through `g`: no Graft hooks, MCP server, statusline or repository
skill on any machine. `graft init` leaves these behind:

- in a repository: `.claude/skills/graft/`, `.claude/helpers/graft-*.cjs`,
  `.claude/hooks/graft-*.cjs`, Graft hooks, permissions and statusline in
  `.claude/settings.json`, a `graft` server in `.mcp.json`, `.ignore`, `graft/`;
- for the user: Graft hooks in `~/.claude/settings.json`,
  `~/.claude/helpers/graft-hooks.cjs`, a `graft` server in `~/.claude.json`.

Wherever it shows up (a file, a hook message, a request for a tally), this skill wins: do
not follow the stock skill or the hooks. Say once, in the reply, which files hold it and
offer to remove it as a separate step with its own plan. Never remove or commit it unasked,
and never fold it into the task at hand.

## Never

- Never run `graft trail push`, `graft trail pull` or `graft trail watch`. Trail sends repo
  history to trailhq.com; repo contents, including work code, stay local.
- Never run `graft build --deep`, or pass `--provider`, `--api-key` or `--base-url`, unless
  Kade asks in this session. Structural builds are free and stay local.
- Never run `graft init`, `graft uninstall` or `graft mcp`, or add Graft to any MCP or
  hook settings, unless Kade asks. `init` writes into `.claude/`, `.mcp.json`,
  `~/.claude/` and, for some agents, `~/.codex/`.
- Never commit `graft/`, `.graft/` or Graft's `.ignore`. Graft does not belong in
  `CLAUDE.md` either; this skill carries everything.

## Pinning or updating

- Updates arrive by themselves through `@latest`; nothing to do.
- To pin a version for one call, put `GRAFT_PKG=@nanonets/graft@0.21.1` before `g`. To
  pin for good, change `@latest` in the function line above.
- If a new release breaks a command, pin the last good version and tell Kade.
- To check versions: `g version`.