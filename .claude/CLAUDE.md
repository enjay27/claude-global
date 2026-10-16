# kade-agent/agent-config, branch local-config: this branch's own notes

The root `AGENTS.md` is the local setup's global rules, installed as `~/.claude/AGENTS.md` (and
`~/.pi/agent/AGENTS.md`) by `setup/install.cjs`; the root `CLAUDE.md` is the one line
`@AGENTS.md`. Neither holds anything about this repository. `install.cjs` copies only the
files it lists, so this file is never installed.

## What this branch is

- The company line of the rules: Windows 10, local repositories, no push, no CI, local models.
  It never merges into `main` (the GitHub setup); a fix to a shared part (`context-guard`, the
  skills) is ported by hand in either direction.
- Public: nothing here names a company, an internal path or a host.

## Gates

| Part | Gate |
|---|---|
| `AGENTS.md`, `CLAUDE.md`, `skills/`, `hooks/`, `tools/`, `setup/`, `settings.global.json` | `node --test` |
| Windows 10: Git for Windows, cmd.exe running a gate, `%USERPROFILE%` paths | NOT VERIFIED until run on the developer's PC |
| A local model following the rules and skills (Claude Code, Pi) | NOT VERIFIED until a session there |

## Version control

- Work on this branch: `claude/<task>` from `local-config` and back into it, or commits on
  `local-config` itself when the developer asks for that. Bump line 1 of `AGENTS.md` with any
  change to the rules or skills.
