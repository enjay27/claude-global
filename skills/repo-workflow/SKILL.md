---
name: repo-workflow
description: The developer's standing way of working in every local repository on this PC (no push, no remote to manage) - plan first, test first, run the gates, keep the task in agent-board, write the PR doc, ask before merging. Use at the start of any task that edits code, config or docs in a repository.
---

# Workflow (local setup)

The repository's own `AGENTS.md` or `CLAUDE.md`, if it has one, says **what** applies there:
its parts and gates. This skill says **how** to work in any of them, whichever agent you are.
The standing rules are the global rules (`~/.claude/AGENTS.md`); this skill holds the
procedures behind them. `agent-board` is `node ~/.claude/tools/agent-board.cjs`; run it inside
the repository.

## 0. Once per repository

If `agent-board board` says there is no project, ask the developer to run
`node setup\install.cjs --repo <path>` from the local-config clone (LF attributes and the
project), then set the gate: `agent-board config gate="gradlew.bat test"` (the command they name).
Other settings: `mainBranch`, `merge` (`no-ff` or `squash`), `subjectPattern` (a regular
expression the subject must match, such as a ticket key), `phases`.

## 1. Plan before editing

- Find the task (`agent-board board`) or create it (`agent-board new "<title>" --priority P2`).
- Locate the code first, then present an impact analysis: which files change, what logic changes,
  what does not, which gate applies, and whether this session can run it. Write the plan into
  the task file's *Plan* section as well.
- **A new module or dependency is decided with the developer first**: the options, their
  long-term upkeep (API stability, upgrade cost, licence, whether the company allows it) and
  your recommendation; build after they pick.
- **A decision brief** is: 2 to 3 options in a table, the upkeep cost of each, your
  recommendation, open questions. Set `waiting=developer` on the task while it waits.
- **Anything that leaves this PC** (a download, an install, a message): say what it is and why,
  then ask. Company code, names and errors never go into a web search or an online service.
- "Follow your recommendation" means: do what you recommended.

## 2. Execute

- `agent-board start <id>` after approval: a clean tree, main updated with `git pull --ff-only`,
  the branch `agent/<id>-<slug>`, the PR doc skeleton. A second agent at the same time:
  `agent-board start <id> --worktree` and work in the folder it prints.
- If start cannot update main (offline, or main has the developer's changes), ask; `--no-pull`
  only when they say so.
- One task at a time. Edit files in place; never retype a file from earlier tool output.
- Commit as you go on the task's branch, with your own identity on each commit.

## 3. Verify honestly

- **A failing gate is not yet your change's fault:** run it on the unchanged main branch first.
  A missing tool is installed only if the developer agrees; otherwise `NOT VERIFIED`.
- A blocked network host is **asked for**, never worked around: no mirrors, stubs or patched
  dependencies.
- Before reporting a hang, check your own time limit.

## 4. The PR doc and the merge

- The PR doc (`agent-board show <id>` prints its path) is the merge commit's message:
  line 1 the subject (the finding or the point of the change, never "fix bug" or
  "update file"), then *What changed and why* (with numbers, and which earlier belief it
  corrects), *Verified*, *NOT VERIFIED*, *Wrong turns* (approaches tried and dropped). Write
  "none" where nothing applies; no `TODO` may remain.
- `agent-board finish <id>` checks the doc and the branch and sets *In review*. Then ask the
  developer, in one short message: the subject, the commits, the gate result, the doc's path.
- Only after they say yes: `agent-board merge <id> --author "<Your name> <noreply address>"`.
  A conflict or a failed gate merges nothing: fix it on the branch (merge the main branch into
  it if needed), `finish` again, ask again.
- A gate that cannot run on this PC: `--no-gate "<reason>"`, only when the developer agrees;
  it records `NOT VERIFIED: gate: <reason>` in the message.
- The developer's own uncommitted changes stay untouched unless the task is about them.

## 5. Record state

- The task file is the state: fields with `agent-board set` (`status`, `priority`,
  `verification`, `waiting`, `phase`, `target`), findings and the next step in its text.
- A check left for the developer: `verification="NOT VERIFIED"`, and say which check in the text.
- A follow-up found on the way: `agent-board new` for it; never widen the current task.
