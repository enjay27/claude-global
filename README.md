# claude-skills

Kade's account skills and the tests that check them. Everything that applies to every
repository (global rules, the `context-guard` hook, the setup plans) lives in
[`enjay27/claude-global`](https://github.com/enjay27/claude-global).

| Path | What | How it is used |
|---|---|---|
| `skills/repo-workflow/` | The procedures behind the global rules for any of Kade's repositories: plan, gates, commit and PR style, state | Saved as a claude.ai account skill |
| `skills/handoff-trigger/` | When to ask about or recommend a handoff and a new session, from the context size and the next task (a `context-guard` message, a compaction, a totally different type of task) | Account skill |
| `skills/code-graph/` | Orient in a repository with Graft's code graph (callers, blast radius) instead of exploring file by file; no install, no telemetry, no Trail, no Graft hooks or MCP server | Account skill |
| `skills/session-resume/` | Start a session from the recorded state | Account skill |
| `skills/session-handoff/` | Close a session: park the task, record state, print a starter prompt | Account skill |
| `scripts/` | Scenario harness and fixtures for testing the skills | Run by the session changing a skill |
| `docs/skill-*.md`, `docs/skills-improvement-plan.md` | Scenarios, their results, and the improvement plan | Read by the session changing a skill |

Account skills apply in Claude Code (terminal and cloud) and Cowork sessions. Each repository's
`CLAUDE.md` keeps its own gates, paths and branch rules and names what it overrides of the global
rules; the skills never hold repository-specific facts.

`repo-workflow` and `code-graph` were `kade-workflow` and `graft-kade` until 2026-10-09; older
docs under `docs/` keep the old names.

## Changing a skill

Edit `skills/<name>/SKILL.md` here, commit, then ask Claude to propose the updated skill and
save it from the card. The file here is the source; the account copy follows it.
