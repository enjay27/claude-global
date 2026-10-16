Local rules: local-2026.10.16

# Global rules: local setup

For any agent (Claude Code, Pi or another) on a developer's Windows PC where repositories are
local: no push, no remote to manage, no CI. Tasks, PR docs and state live in AgentNotes, outside
every repository, kept by `agent-board` (`node ~/.claude/tools/agent-board.cjs`).

## Precedence

- A repository's own `AGENTS.md` or `CLAUDE.md` wins over this file and the skills where it
  says so; nothing else silently.
- Procedures: the `repo-workflow` skill. Sessions: `session-resume` and `session-handoff`.
  When to hand off: `handoff-trigger`.

## How to work

- Plan first: no edits on the first turn of a task. Present what changes, what does not, the
  gate and whether you can run it; then wait for the developer's explicit approval. Approval
  covers the steps in the plan; a new step that widens the scope goes back to the developer.
- A new module, dependency or service is the developer's call: options, upkeep cost, a recommendation.
- Test first: a failing test before new behaviour or a fix, seen failing for the right reason.
  If something cannot be unit-tested, say so in the PR doc.
- At most 2 self-corrections on a failing gate, then stop and report.
- A refactor changes no behaviour: move first, change later, never both in one commit.
- Run the gate for every part touched. A gate that could not run is never reported as passed:
  name it as `NOT VERIFIED: <gate>: <reason>` in the PR doc.
- Read only what the task needs, and keep command output short: the context is the limit.

## Tasks and AgentNotes

- Every piece of work is a task: `agent-board new "<title>"`. Its files are in
  `AgentNotes\<project>\` (`%USERPROFILE%\AgentNotes`, or `AGENT_NOTES_DIR`); `<project>` is the
  folder name of the repository's main checkout.
- Change task fields only with `agent-board set`, never by hand; the text below the fields
  (goal, plan, findings) is yours to write. `STATUS.md` there is the board; never edit it.
- A decision that is the developer's: `agent-board set <id> waiting=developer`, and ask.
- AgentNotes is a local git repository that `agent-board` commits. Never give it a remote, never
  move it into a synced folder (OneDrive): it holds company information.
- Nothing an agent writes for itself (state, notes, plans, PR docs) goes into a repository.

## Git

- One task, one branch: `agent-board start <id>` makes `agent/<id>-<slug>` from the updated
  main branch (`--worktree` for a second agent at the same time). Never commit to the main branch.
- Each agent authors its own commits, with its own name and a noreply address, passed per
  commit (`git -c user.name=… -c user.email=… commit`), never in git config. Never as the developer.
- Subject: the finding or the point of the change, not the files touched. Body: what changed,
  with numbers; why; what is verified and what is still open.
- `git status` before `git add -A`, never after. Never commit work you did not do.
- Never commit a broken or half-applied tree to save progress: use the task's branch. Never
  rewrite the history of a branch you did not create, nor of the main branch.
- Done: fill the PR doc (`AgentNotes\<project>\prs\<id>-<slug>.md`), run `agent-board finish <id>`,
  then ask the developer to merge. Only after they say yes: `agent-board merge <id> --author "<Name> <email>"`.
  It runs the gate on the merged tree and uses the PR doc as the merge message.
- Never push, never add or change a remote; `git pull --ff-only` and `git fetch` only.
- Line endings: `.git/info/attributes` (from `install.cjs --repo`) stores text with LF. Never
  add a `.gitattributes` or any agent file to a repository to change that.

## Windows, IDEs and company data

- Windows 10, no WSL. Agents' shell is Git Bash; the project's own commands are Windows ones
  (`gradlew.bat`, `mvnw.cmd`, `npm`). Quote paths: they may hold spaces.
- IntelliJ and VS Code may have the files open: leave `.idea/`, `.vscode/` and `*.iml` alone
  unless asked; run gates from the command line, not the IDE.
- Company code and data never leave the machine: no web search with code, names or errors from
  it; no paste sites; no online model or service.
- Never commit secrets (tokens, keys, keystores, `*.pem`, `.env`).
- A blocked network host is asked for, never worked around: no mirrors, stubs or patched dependencies.

## The agents' own files

- This file at most 100 lines; skills in `~/.claude/skills/<name>/SKILL.md` (Pi:
  `~/.pi/agent/skills/`), each with `name` and `description`. They are installed from the
  local-config clone by `setup/install.cjs`; change them there, never in place.
