# agent-config: the local-config line

The global rules, skills and tools for agents (Claude Code, Pi) on a Windows PC whose
repositories are local only: no push, no remote to manage, no CI, a local model. Public, and
kept generic: nothing here names a company, a path or a host.

`main` is the GitHub setup (releases, issues, the Project, Actions). This branch never merges
into it; a fix to a shared part (`hooks/context-guard.cjs`, the skills) is ported by hand.

## What replaces what

| GitHub setup (`main`) | Here |
|---|---|
| Issues, Project fields, `cmd:` labels | Task files in `AgentNotes\<project>\tasks\`, changed with `agent-board set` |
| `STATUS.md` on the `status` branch | `AgentNotes\<project>\STATUS.md`, rewritten on every change |
| Pull request and its description | The task branch, the PR doc in `AgentNotes\<project>\prs\`; `agent-board merge` after the developer's yes |
| Release tags, `global-sync`, `agent-sync` | `git pull` in the clone, then `node setup\install.cjs` |
| `.gitattributes` in every repository | `.git\info\attributes` in each repository (`install.cjs --repo`), never committed |
| claude.ai account skills | `~/.claude/skills/` and `~/.pi/agent/skills/` |

AgentNotes (`%USERPROFILE%\AgentNotes`, or `AGENT_NOTES_DIR`) is a local git repository, one
commit per change, never a remote. `<project>` is the folder name of the repository's main
checkout; worktrees share it, and `.git\agent-project` names it when two repositories share a
folder name.

## Setup, once per PC

Needs Git for Windows 2.31 or later and Node 20 or later. In PowerShell or cmd:

```bat
git clone -b local-config https://github.com/kade-agent/agent-config %USERPROFILE%\local-config
node %USERPROFILE%\local-config\setup\install.cjs
```

It writes into `%USERPROFILE%\.claude` (and `%USERPROFILE%\.pi\agent` if Pi is installed) only
files it installed itself; any other file in the way stops it before it writes anything. Your
own Claude Code rules can go in `%USERPROFILE%\.claude\rules\`. For a model with a 200K window:
`setx CLAUDE_CONTEXT_WINDOW 200000` (the default is 1M).

To update: `git -C %USERPROFILE%\local-config pull`, then run `install.cjs` again.
`install.cjs --dry-run` shows what it would change.

## Setup, once per repository

```bat
node %USERPROFILE%\local-config\setup\install.cjs --repo C:\work\shop
cd C:\work\shop
node %USERPROFILE%\.claude\tools\agent-board.cjs config gate="gradlew.bat test"
```

`--repo` writes the LF attributes into `.git\info\attributes` and creates the project in
AgentNotes. It reports how many files the repository already stores with CRLF: a commit that
touches one stores it with LF, so the whole file shows as changed. `--main <branch>` names the
main branch when it is not `main`, `master` or `develop`. Other settings: `merge=squash`,
`subjectPattern=<regular expression>` (for example a ticket key), `phases=Beta,Release`.

## agent-board

`node %USERPROFILE%\.claude\tools\agent-board.cjs <command>` inside the repository (agents call
it as `node ~/.claude/tools/agent-board.cjs` from Git Bash):

| Command | Does |
|---|---|
| `new "<title>" [--priority P1] [--phase …]` | A task `T-NNNN`, status Backlog |
| `set <id> status=Next priority=P2 waiting=developer …` | Changes fields; checks every value first |
| `board`, `show <id>`, `snapshot` | The board, one task, `STATUS.md` again |
| `start <id> [--worktree] [--no-pull]` | `git pull --ff-only` on main, branch `agent/<id>-<slug>`, the PR doc skeleton; Now |
| `finish <id>` | The PR doc is filled, the branch has commits, the tree is clean; In review |
| `merge <id> --author "<Name> <email>"` | Merge, the gate on the merged tree, the PR doc as message, branch removed; Done. A conflict or a failed gate merges nothing |
| `config [key=value …]`, `init` | `project.json`; set up a repository's project |

## Layout

| Path | What |
|---|---|
| `AGENTS.md` | The rules; line 1 is the version (edit it by hand on a change) |
| `CLAUDE.md` | `@AGENTS.md` |
| `skills/` | `repo-workflow`, `session-resume`, `session-handoff`, `handoff-trigger` |
| `hooks/context-guard.cjs` | The context-size warning (Claude Code only), registered from `settings.global.json` |
| `tools/agent-board.cjs` | The Project and Board in AgentNotes |
| `setup/install.cjs` | The installer |
| `tests/`, `*.test.cjs` | `node --test` |
| `.claude/CLAUDE.md` | This branch's notes for a session working on it; never installed |

## Tests

```bash
node --test
```
