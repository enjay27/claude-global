---
name: session-resume
description: Start a session in a local repository by reconstructing where the work stands - read the board in AgentNotes (STATUS.md and the task files), the agent branches and worktrees, the last merges and git status, then summarize and propose the next task. Use when the developer opens a session with "resume", "continue", "where were we", or pastes a starter prompt from a handoff.
---

# Session resume

Goal: in one short reply, the developer sees where things stand and what you propose to do
next. Do not edit anything until they confirm (repo-workflow, plan first). `agent-board` is
`node ~/.claude/tools/agent-board.cjs`, run inside the repository.

## 1. Read the board

```bash
node ~/.claude/tools/agent-board.cjs board
```

It prints every column and the path of `STATUS.md`; read that file for *Waiting on the
developer*, *NOT VERIFIED* and the roadmap. If there is no project yet, say so and point to
`repo-workflow` section 0.

If the developer pasted a starter prompt from `session-handoff`, it names the task, branch and
next step: trust it, then confirm with `agent-board show <id>` and the task file's text.

## 2. Read the recent work

- `git status` and the current branch. Uncommitted changes are the developer's unless the
  starter prompt says they are a parked task.
- `git branch --list "agent/*"` and `git worktree list`: a task branch is work in flight; its
  last commit (a `WIP:` subject means parked) and the task file say where it stopped.
- The last 3 to 5 merges on the main branch (`git log --merges -5 --format="%h %s"` and
  `git log -1 --format=%B <hash>` for one): read their *NOT VERIFIED* and *Wrong turns*.

## 3. Report (at most about 15 lines)

- **Where things stand**: one or two lines.
- **Now** and **In review**: the tasks, with their branches.
- **Waiting on the developer** first (decisions and merges to approve), then **NOT VERIFIED**
  (checks left for them), then anything unproven.
- **Proposed next task**: one task, with the gate it needs and whether this session can run it.

Then ask them to confirm or redirect.
