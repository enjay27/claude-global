---
name: release-flow
description: How every release is made in Kade's repositories - a version PR into main, a pull request from main into rc that the agent opens, then Kade's manual Release run on rc, which tags and publishes. Use whenever Kade asks for a release, a release candidate, a version bump or a tag, and before touching the rc branch, release workflows or release checks in any repository.
---

# Release flow

One flow in every repository; a repository's `AGENTS.md` (or `CLAUDE.md`) says only where its
version and release notes live, never the flow itself.

```
main --(1) version PR--> main --(2) PR main -> rc--> rc --(3) Kade: Actions > Release on rc--> tag v<version> + release
```

## 1. Version change into main

- A normal `claude/<task>` PR into `main`: the version bump where the repository keeps it, and its
  release notes if it has them. It merges like any other PR.
- The version is Kade's: use the one he named; otherwise propose one (patch for fixes only,
  minor for features, major for a break) and ask before committing.
- A repository whose release tag is computed rather than written (agent-config: `vYYYY.MM.DD`)
  skips this step.

## 2. Pull request from main into rc (the agent opens it)

- After step 1 has merged, `git fetch origin`, then open it with `main` itself as the head, never
  a copy branch:
  `gh pr create --repo <owner/repo> --base rc --head main --title "Release v<version>: main into rc"`.
- The body: the version; what main brings into `rc` since the last release
  (`git log --no-merges origin/rc..origin/main`, grouped by PR with links); the `NOT VERIFIED`
  lines of those commits; what Kade should try on the candidate build, if the repository makes one.
- Not a draft, and no auto-merge: Kade merges it by hand. Read its checks and report them. A red
  check is fixed on `main` (a fix PR, or step 1 again); the open PR follows `main` by itself.
- One such PR at a time; if one is already open, update its body instead of opening another.

## 3. Kade runs the release

- Tell Kade it is ready: "Actions > Release > Run workflow > branch `rc`". He starts it; the
  workflow checks rc's head, gates, builds, creates the tag `v<version>` on that commit and
  publishes.
- When he asks, read the run (`gh run list --workflow release.yml`, `gh run view --log-failed`)
  and record the result on the issue. A failed run is fixed on `main` and goes through 2 and 3
  again; a half-made release (a tag or release left behind) is reported, and Kade removes it.

## Never

- Push a `v*` tag, create, edit or delete a GitHub release, or start the Release workflow.
- Commit or push to `rc`, open a PR into `rc` from anything but `main`, or merge `rc` into `main`.
- Work around a refused check (the head, the version, the notes) instead of fixing it on `main`.

## What a repository needs for this flow

Moving a repository onto it is its own task (plan first). The pieces:

- **`release-checks.yml`** on `pull_request` into `rc`: `the head is main` (head ref `main`, same
  repository) and `version is new` (above every `v*` tag, not tagged yet; release notes fit, if
  the repository keeps them).
- **`release.yml`** on `workflow_dispatch` only. It refuses unless it runs on `rc`, rc's head is the
  merge of a PR from `main` into `rc` whose head has the same tree, that commit has no `v*` tag,
  and the version is new. It creates the annotated tag on that commit itself and then the release
  (`gh release create --verify-tag`). The workflow is read from `rc`: a change to it acts after it
  reaches `rc`.
- **Rulesets (Kade's):** on `rc`, both checks required (a skipped job counts as passed, so
  `the head is main` on its own too) and no direct pushes; on `v*` tags, no moving or deleting.
- Auto-merge acts only on `claude/*` into `main`, never on a PR into `rc`.
- Optional: a candidate build on every push to `rc` (a prerelease Kade tests before step 3).
- The repository's rules: one line pointing here, plus where its version and notes live.

Reference implementations: `stella-rain/core` (`release.yml`, `release-checks.yml`, ADR-054);
`star-resonance/resonance-stream` (D-30: a candidate exe on `rc`, a signed update feed);
`kade-agent/agent-config` (a date tag that stamps line 1 of `AGENTS.md`).
