# claude-global

Kade's Claude configuration for every repository: the global rules, the hooks, and the plans
that move each repository onto them. Public. The account skills live in
[`enjay27/claude-skills`](https://github.com/enjay27/claude-skills).

| Path | What | How it is used |
|---|---|---|
| `CLAUDE.md` | The global rules, loaded in every session as `~/.claude/CLAUDE.md`; line 1 is the release | Released by the Release workflow |
| `hooks/context-guard.cjs` | Shows the context number at 300k tokens, recommends (never forces) a handoff at 400k (never later than 40% / 60% of the window), and after a compaction | User-level `UserPromptSubmit` and `SessionStart` (compact) hooks, registered from `settings.global.json`; repositories no longer vendor a copy |
| `hooks/global-sync.cjs` | Keeps `~/.claude` on the latest release tag; prints the new rules into the session that moved | User-level `SessionStart` hook, registered from `settings.global.json` |
| `settings.global.json` | The hook entries merged into `~/.claude/settings.json` (only entries pointing into `~/.claude/hooks/`) | Read by `global-sync` |
| `deploy-exclude` | The allowlist for `~/.claude`: nothing else there can be tracked | Copied to `~/.claude/.git/info/exclude` |
| `setup/cloud-setup.sh` | Checks this repository out into `~/.claude` in a cloud session | Pasted into the cloud environment's setup script |
| `setup/local-setup.ps1`, `setup/local-setup.sh` | The same on a Windows PC (PowerShell, not Git Bash) and on macOS or Linux, once per machine | Run by Kade; they stop before overwriting anything |
| `.github/workflows/release.yml` | Release: on `rc`, tags `vYYYY.MM.DD` (`.2` later the same day) on a commit that stamps line 1 of `CLAUDE.md`, with a GitHub release | Started by Kade (Actions → Release → Run on `rc`) after a PR from `main` into `rc` |
| `scripts/release.cjs` | `next`, `stamp <tag>`, `latest` | Called by the Release workflow |
| `docs/global-rules-plan.md` | One global rule set checked out as `~/.claude` on every machine and in the cloud, plus rules per repository | Closed 2026-10-09; every step done |
| `docs/refactor-plan.md` | Moving `CLAUDE.md`, `MEMORY.md`, skills and rules to this setup, per repository | Read by the session doing the work |
| `docs/governance-plan.md` | Proposed: two daily reports over the working repositories, drift (rules and workflows, filed as issues) and daily results (per owner), built in `kade-agent/governance` | Accepted by Kade before any step is built |
| `docs/repo-rules-review.html` | 2026-10-11 audit: each repository's rules and workflows against the global rules, with advice and proposed global changes | Read as an Artifact page (the Mermaid diagrams render there); its actions become their own PRs |

Each repository's `CLAUDE.md` keeps its own gates, paths and branch rules and names what it
overrides of the global rules; nothing here holds repository-specific facts.

## Tests

```bash
node --test        # every *.test.cjs: hooks, release script, repository checks
```

## The context hook

The hook assumes a 1M window (the default of Opus 4.7+, Sonnet 5+ and the Fable models). Set
`CLAUDE_CONTEXT_WINDOW=200000` for a 200k-window model; the lines then fall to 80k and 120k.
