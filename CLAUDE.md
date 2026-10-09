Global rules: v2026.10.09.4

# Kade's global rules

For every repository of Kade's (`stella-rain`, `star-resonance`, `enjay27`), everywhere.

## Precedence

- Follow `repo-workflow` for procedures (PR description, state), `handoff-trigger` for handoffs.
- A repository's `CLAUDE.md` wins over this file and the skill. It names each global rule it
  changes under "Overrides of global rules"; follow those and nothing else silently.

## How to work

- Plan first: no edits on the first turn of a task. Present what changes, what does not, the
  gate and whether this session can run it; then wait for explicit approval. Approval covers
  the steps in the plan; a new step that widens the scope goes back to Kade.
- A new module, crate, dependency or service is decided with Kade first: the options, their
  long-term maintenance cost, a recommendation.
- Test first: a failing test before new behaviour or a fix, seen failing for the right reason.
  If something cannot be unit-tested, say so in the commit body.
- At most 2 self-corrections on a failing gate, then stop and report.
- A refactor changes no behaviour: move first, change later, never both in one commit.
- Run the gate for every part touched. A gate that could not run is never reported as passed:
  name it as `NOT VERIFIED: <gate>: <reason>` in the commit body or the PR.

## Git and pull requests

- Commits Claude makes are authored `Claude <noreply@anthropic.com>`; locally pass it per commit
  (`git -c user.name=Claude -c user.email=noreply@anthropic.com commit`), never in git config.
  PRs, issues and merges are Kade's: Claude opens them through his GitHub account.
- Subject: the finding or the point of the change, not the files touched. Body: what changed,
  with numbers; why; what is verified and what is still open.
- `git status` before `git add -A`, never after. Never commit work you did not do.
- Never commit a broken or half-applied tree to save progress; use a branch. Never rewrite
  history that is already pushed.
- Local sessions: follow the repository's flow.
- Cloud sessions: branch `claude/<task>` from an up-to-date `main`, push, open a PR, then turn
  on GitHub auto-merge for it, unless the repository merges through its own auto-merge
  workflow. Never merge by hand; never commit to `main`.
- One task per PR; start the next only after the merge. Wait with the PR event subscription and
  a scheduled check-in, never with `sleep` loops.
- Never skip, disable or weaken a test or check to get green. A failure that is not this PR's
  (red on `main` too) is said on the PR.

## Secrets and public repositories

- Never commit secrets (tokens, keys, keystores, `*.pem`, `.env`); real values stay outside git.
- In a public repository everything is public, issues and Actions logs included: no internal
  URLs, personal data or private planning. Those belong in a private repository.
- GitHub workflows: `permissions: {}` at the top and per-job grants; `actions/checkout` with
  `persist-credentials: false`; actions pinned to a major version.

## Machines and Claude's own files

- Every repository has `.gitattributes` with `* text=auto eol=lf`; no CRLF files.
- On Kade's Windows PC the remote file tools cannot write `.github/` or `.claude/`: deliver
  those files as a zip laid out from the folder above the repositories, with the commit command.
- `CLAUDE.md` at most 100 lines; each `.claude/rules/*.md` at most 80 lines, with `paths:`.
