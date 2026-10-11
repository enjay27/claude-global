---
name: handoff-trigger
description: Decide when to ask about or recommend a handoff and a new session, from the size of the context and the next task. Use when a `context-guard` message appears, right after a compaction, when a finished task is followed by a totally different type of task while the context is about 200k to 400k tokens, when the context is about 400k or more, or when you notice the session degrading (repeating a fix Kade rejected, forgetting a guardrail). It asks or recommends and offers the choices, never forces; the `session-handoff` skill does the handoff.
---

# Handoff trigger

This is about the session, not the task. The `context-guard` hook (in `enjay27/claude-global`) warns
by size; this skill says what to do when it does, and what to do in a session without the hook.

Quality drops gradually as the context fills ("context rot"), well before the window is full, and
auto-compaction replaces history with a summary. **Task boundaries matter more than the number.**

## When, for a 1M window

| When | Context | Do |
|---|---|---|
| A task is finished and the next is a **totally different type** | 200k to 400k | **Ask** |
| The context is at **400k (40%)** or more | 400k+ | **Recommend** |
| You notice yourself degrading (below) | under 400k | **Ask** |
| Right after a compaction | any | Offer the three choices |
| Anything else | under 400k | Nothing; at 300k (`context-guard` shows it) the number in one line |

Never **recommend** a handoff under 400k. A smaller window: the number at 40% and the
recommendation at 60% of it (as `context-guard` does), the question from half the recommendation.

- **A totally different type of task** is one of: a different repository; a different kind of work
  (code change to research or a question, docs to CI or infrastructure, a feature to reviewing
  someone else's PR); or no shared files or plan with the task just finished. Not: review fixes on
  the same PR, the next step of the same plan, a follow-up bug in the same feature. The new task
  reads new files, which would sit on top of a context that no longer helps. Only at a task
  boundary, never mid-task.
- **Degrading:** you repeat a fix Kade already rejected, you have been corrected twice on the same
  issue, you forget a guardrail, or you re-read files you already saw. Say what you noticed.

## How

- **Ask** in one neutral line, as a question, not a recommendation: "This is a different type of
  task; hand off to a new session, or continue here?" Ask before reading anything for the new
  task, then wait for the answer.
- **Recommend** in one line with the number, and offer three choices:
  1. **handoff and a new session** (the `session-handoff` skill),
  2. `/compact` with a focus he names,
  3. continue.

  **Recommend, never force:** after that line, carry on with his request the normal way in the
  same reply (`repo-workflow`: a plan, then wait for approval). Do not hold the work back until he
  answers the choices. Recommend once when the context crosses 400k, then once at each new task
  while it stays above; for a totally different type of task, ask and wait as above.
- Say it **in your first reply, before any edit, commit or other command**, even when his message
  is only "go on": that does not answer the question or the choices. If you cannot read the
  number, say so; never call the context small.
- In sessions without the hook, follow the same table from the number you can read (the status
  line, `/context`); after a finished task when the session has run many large tool outputs,
  check the number before the next task.
- Finish or park the current step before a handoff; never hand off mid-edit. Update the state
  (*Now* or the Project) and commit first, so the new session starts from that summary.
