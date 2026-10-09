# Where each global rule came from

Step 3 of `global-rules-plan.md`, 2026-10-09. Candidates were read from the `CLAUDE.md` files of
the `stella-rain` repositories (`app`, `core`, `moderation`, `stage-template`, `.github`) and the
`star-resonance` repositories (`resonance-stream`, `resonance-lab`), plus `kade-workflow`; Kade
confirmed every row. After the first release, step 6 removes these lines from the repositories
and keeps only their overrides.

| Rule in `CLAUDE.md` | Stated today in |
|---|---|
| Follow `kade-workflow`; the repository wins and names its overrides | app, core, moderation, .github, resonance-stream |
| Plan first, explicit approval, scope | resonance-lab; `kade-workflow` 1 |
| New module, crate, dependency or service decided with Kade | app, core, moderation, .github; `kade-workflow` 1 |
| Test first | resonance-stream, resonance-lab; `kade-workflow` 2 |
| At most 2 self-corrections | resonance-stream, resonance-lab; `kade-workflow` 3 |
| Refactors change no behaviour | resonance-stream, resonance-lab; `kade-workflow` 3 |
| Gate for every part touched; `NOT VERIFIED` | app, core, resonance-stream, resonance-lab; `kade-workflow` 4 |
| Commit author: Claude; PRs, issues and merges: Kade | Kade, 2026-10-09: replaced "Author: Kade" from app, core, moderation, .github, whose own lines must go in step 6 or they keep overriding it |
| Commit subject and body | app, core, resonance-lab; `kade-workflow` 5 |
| `git status` before `git add -A`; never commit others' work | resonance-lab; `kade-workflow` 5 |
| No half-applied tree; never rewrite pushed history | resonance-stream, resonance-lab |
| Local sessions follow the repository; cloud sessions `claude/<task>`, PR, auto-merge | app, core, resonance-stream, resonance-lab (cloud); local flows differ, so they stay per repository |
| One PR at a time; wait with the subscription and a check-in | app, core, resonance-stream, resonance-lab |
| Never weaken a check; say a failure that is not this PR's | app, core, resonance-stream, resonance-lab |
| No secrets | all seven |
| Public repositories | core, moderation, .github, stage-template |
| Workflow permissions, credentials, pinned actions | .github |
| LF line endings | app, core, moderation, .github |
| Windows PC zip delivery | app, core, moderation, .github |
| `CLAUDE.md` 100 lines, rules 80 with `paths:` | `.github/scripts/claude_md_check.py`, resonance-stream |

Stays in each repository: domain rules, gates, layout, release flows, local commit flow, and
the organization Project with its `cmd:` labels.
