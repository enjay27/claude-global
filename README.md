# claude-global

Kade's Claude configuration for every repository: the global rules, the hooks, and the plans
that move each repository onto them. Public. The account skills live in
[`enjay27/claude-skills`](https://github.com/enjay27/claude-skills).

| Path | What | How it is used |
|---|---|---|
| `hooks/context-guard.cjs` | Warns at 200k tokens of context, recommends a handoff at 400k (never later than 40% / 60% of the window), and after a compaction | Copied into each repository's `.claude/hooks/`; merge `hooks/settings-snippet.json` into its `.claude/settings.json`. Moving to user level: see the plan below |
| `docs/global-rules-plan.md` | One global rule set checked out as `~/.claude` on every machine and in the cloud, plus rules per repository | Proposed; steps wait for Kade |
| `docs/refactor-plan.md` | Moving `CLAUDE.md`, `MEMORY.md`, skills and rules to this setup, per repository | Read by the session doing the work |

Each repository's `CLAUDE.md` keeps one line, *"Follow the `kade-workflow` skill"*, and its own
gates, paths and branch rules; nothing here holds repository-specific facts.

## Tests

```bash
node --test hooks/context-guard.test.cjs
```

## Installing the hook in a repository

```bash
mkdir -p .claude/hooks
cp ~/claude-global/hooks/context-guard.cjs .claude/hooks/
# merge hooks/settings-snippet.json into .claude/settings.json (keep existing hooks such as graft)
```

The hook assumes a 1M window (the default of Opus 4.7+, Sonnet 5+ and the Fable models). Set
`CLAUDE_CONTEXT_WINDOW=200000` for a 200k-window model; the lines then fall to 80k and 120k.
