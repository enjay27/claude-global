---
name: session-handoff
description: Close a session in a local repository so a fresh session can continue - finish or park the current task, record state in its task in AgentNotes, and give the developer a starter prompt to paste into the new session. Use when the developer asks for a handoff, says the context is getting full, or picks the handoff option after a context-guard warning or a handoff-trigger question or recommendation.
---

# Session handoff

A handoff writes nothing that git and AgentNotes (the task file, the PR doc) do not already
hold. Its output is a short starter prompt, not a document. `agent-board` is
`node ~/.claude/tools/agent-board.cjs`, run inside the repository.

## 1. Stop new work

Finish the current step. Do not start anything new.

## 2. Finish or park the task

- **Finished:** the normal flow (repo-workflow): gate, PR doc, `agent-board finish <id>`, then
  ask the developer to merge. Never merge without their yes, not even to tidy up.
- **Unfinished:** commit on the task's branch, never the main branch, with the subject
  `WIP: <what is done so far>` and a body that names the next step and anything
  half-understood. Never leave uncommitted changes of your own behind.

## 3. Record state

- In the task file's text: *Done so far*, *Next step*, *Watch out* (one line each).
- Fields with `agent-board set <id>`: `status=Now` for a parked task (it stays on its branch),
  `verification="NOT VERIFIED"` for a check left open, `waiting=developer` for a decision.
- A follow-up found in this session: `agent-board new "<title>"`.
- `agent-board set` commits AgentNotes and rewrites `STATUS.md`; nothing else to save.

## 4. Give the developer the starter prompt

Reply with two or three lines of summary, then a code block they can paste into the new session:

```text
Resume <project> with the session-resume skill.
Continue: <id> <title>, branch <branch>.
Done so far: <one line>.
Next step: <one line>.
Watch out: <one line, or "nothing">.
```

Keep it under 8 lines. Everything else is in git and AgentNotes.
