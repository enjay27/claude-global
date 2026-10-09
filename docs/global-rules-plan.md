# Plan: `claude-global`, one global rule set checked out as `~/.claude`, plus rules per repository

- **Scope:** where Kade's coding and workflow conventions live, how they reach local and cloud
  sessions, and what each repository keeps for itself.
- **Status:** proposed 2026-10-09, revised the same day: checked against the Claude Code docs
  (section 12), then reshaped around a new repository, `claude-global`, checked out as
  `~/.claude`. Nothing is changed yet; every step waits for Kade's yes.
- **Related:** `docs/refactor-plan.md` (the current setup), `docs/skills-improvement-plan.md`
  (what the account skills should say).
- **Decisions wanted:** the split into two public repositories (section 4); tag protection and the
  auto-update rule (section 6); whether `settings.json` stays untracked (section 5).
- **Home:** `enjay27/claude-global`, moved from `enjay27/claude-skills` in step 0 (2026-10-09).

## 1. The question

Kade wants one place for conventions that apply to every repository (coding and workflow), and
repository files that hold only what is specific to that repository: which file to open first,
which directory a new kind of file goes in, repo-only hard rules.

The constraint that shapes the answer: **a cloud session cannot read the home folder of Kade's
PC or Mac**, so a user-level `~/.claude/CLAUDE.md` alone reaches only local sessions.

## 2. The current setup

| Piece | Carries | Reaches |
|---|---|---|
| Account skills (`kade-workflow`, `session-resume`, `session-handoff`, `graft-kade`) | Workflow procedures, loaded when their description matches | Local and cloud |
| Each repository's `CLAUDE.md` | Repo facts, gates, one line "follow `kade-workflow`" | That repository |
| `.claude/rules/*.md` per repository | Path-scoped rules, loaded when a matching file is read | That repository |
| `.claude/hooks/context-guard.cjs`, vendored copy | Context warnings | That repository |

Gaps: no always-on global text (a skill that does not trigger is a rule that is missed); the hook
is copied by hand into each repository, so copies can drift; nothing checks that the account copy
of a skill equals the file in this repository.

## 3. The options

| | A. Today | B. A global repository checked out as `~/.claude` | C. Plugin from a git marketplace | D. CI opens sync PRs into every repository |
|---|---|---|---|---|
| Always-on global text | No | Yes, `~/.claude/CLAUDE.md` and `~/.claude/rules/` | Locally only, through a plugin `SessionStart` hook (plugins cannot ship `CLAUDE.md`). **Cloud sessions do not install plugins a repository enables** | Yes, as a file in each repository |
| Hook | Copied into each repository | Once, in `~/.claude/hooks/`, registered at user level | Yes, but not in the cloud | Copies in each repository |
| Cloud and local identical | Partly | Yes, same tag on PC, Mac and cloud | No | Yes |
| Update path | Upload skills by hand; edit hook copies | Push a tag; every session moves to it at its next start (section 6) | Bump the plugin version | Merge one PR per repository |
| Context cost | ~270 tokens of skill descriptions always; skill bodies when used | A + ~1,000 tokens for a 60-line `CLAUDE.md`, offset by what moves out of `kade-workflow` and repository files | Same as A | Same as B |
| New moving parts | None | The sync hook; tag protection; `github.com` in the cloud network allowlist | Marketplace entry in each repository's `settings.json` | A sync workflow and a token that can open PRs |
| Failure mode | Silent drift | Fetch fails: the session keeps the tag it has and says so; a bad tag reaches every session | Plugin not installed in a session | PR left unmerged, so a repository lags |
| Review of a change | Per repository | One place, one release (the tag) | Same as B | Per repository |

Context cost in numbers: the always-on text is cached after the first turn, so it occupies about
0.5% of a 200k window rather than being paid in full each turn. `kade-workflow` (~1,650 tokens)
already loads in most sessions; moving its short rules into the global `CLAUDE.md` can make B
cost close to nothing net. The real cost is attention, hence the 60-line cap.

Rejected:

- A git submodule, or a nested clone in each repository's `.claude/`: the outer repository cannot
  track files inside a nested repository, so repository-specific rules lose their home, and cloud
  checkouts do not bring the nested clone along.
- The global text pasted into the cloud setup script: no fetch at all, but the text then lives in
  the app's settings, where it cannot be diffed or reviewed.
- A `SessionStart` hook committed to each repository that fetches the text: one copy per
  repository (the problem of D). Kept only as the fallback in
  section 8 if user-level hooks do not run in the cloud.
- Managed policy `CLAUDE.md` or server-managed settings: the only documented route that reaches
  cloud sessions with plugins, but it is for organisations, not one person's account.

## 4. Recommendation: two repositories

Adopt **B** with a new repository.

| Repository | Holds | Reaches sessions through |
|---|---|---|
| `claude-skills` (this one) | Account skills only: `skills/`, the scenario harness in `scripts/`, the skill docs (`skill-scenarios.md`, `skill-scenario-report.md`, `skills-improvement-plan.md`, `skill-candidate-after.diff`) | Uploaded as account skills (unchanged) |
| `claude-global` (new) | Everything that applies to every repository: the global `CLAUDE.md`, `rules/`, `hooks/` (`context-guard.cjs`, the new `global-sync.cjs`, their tests), the settings fragment, the cloud setup script, this plan and `refactor-plan.md` | Checked out as `~/.claude` on the PC, the Mac and in the cloud |

Name: `claude-global` names what the repository is for, pairs with `claude-skills`, and avoids
`dot-claude` or `.claude`, which read like a project's `.claude/` folder.

Each repository's `CLAUDE.md` keeps repo facts only, plus a short section **"Overrides of global
rules"** that names each global rule it changes. Claude Code does not enforce "the repository
wins"; both files are simply in context, so an unstated conflict is a guess.

Skills stay out of `~/.claude/skills/`: they reach every surface as account skills, and a second
copy of the same name would clash.

**Both repositories are public.** Neither holds private data (the history of `claude-skills` was
scanned on 2026-10-09: no keys, tokens, emails or hostnames; it does name Kade's other
repositories and one issue, so publishing it reveals those names, nothing inside them). A public `claude-global` needs no login to fetch, so the
cloud setup and `global-sync` carry no token at all. Public means anyone can read it, not change
it: who can change the rules is still decided by tag protection and the PR rule on `main`
(section 6). Two consequences:

- A secret committed by mistake is public at once. GitHub secret scanning with push protection is
  on, on top of the allowlist and its test (section 5).
- The global `CLAUDE.md` is written for strangers to read: no hostnames, account IDs or facts
  about private repositories. Those belong in the repository they concern.

## 5. The `claude-global` repository

```
claude-global/
  .gitignore              ordinary ignores, plus rules/local*.md
  .gitattributes          * text=auto eol=lf   (Windows checkouts keep LF in .cjs and .md)
  deploy-exclude          the allowlist, below; copied to ~/.claude/.git/info/exclude
  CLAUDE.md               line 1: "Global rules: v<tag>"; under 60 lines
  rules/*.md              global path-scoped rules, only if needed
  hooks/
    context-guard.cjs     moved from claude-skills; path now $HOME/.claude/hooks/
    global-sync.cjs       new: update to the latest tag, merge the settings fragment
    *.test.cjs
  settings.global.json    the hook entries that global-sync merges into ~/.claude/settings.json
  setup/cloud-setup.sh    the text pasted into the cloud environment's setup script
  scripts/release.sh      sets the stamp in CLAUDE.md, commits, tags
  docs/                   this plan, refactor-plan.md
  README.md
```

**Only some paths are deployed.** `~/.claude` is a sparse checkout of
`/CLAUDE.md /rules/ /hooks/ /settings.global.json /.gitignore /.gitattributes`. `setup/`,
`scripts/`, `docs/` and the README exist only in the development clone.

**Two clones on each local machine:**

- `~/src/claude-global` (or wherever Kade keeps repositories): the development clone. Edits,
  tests and pull requests happen here.
- `~/.claude`: the deployed checkout, detached at a tag, sparse, never edited by hand. An edit
  made here would apply to every session at once, before any review.

**The deployed checkout ignores everything but the allowlist.** `~/.claude` also holds session
transcripts (`projects/`), history, caches and, on Linux, the login credentials
(`.credentials.json`). A normal ignore list is one forgotten line from pushing those. The
allowlist lives in `deploy-exclude` and is copied to `~/.claude/.git/info/exclude`, which applies
to that checkout only. (Not as the tracked `.gitignore`: there, `*` would also hide `docs/`,
`setup/` and `scripts/` in the development clone.)

```gitignore
*
!.gitignore
!.gitattributes
!CLAUDE.md
!rules/
!rules/**
rules/local*.md
!hooks/
!hooks/**
!settings.global.json
```

A test fails when a tracked path is neither in that list nor in the development-only paths
(`setup/`, `scripts/`, `docs/`, `README.md`, `deploy-exclude`). Machine-only text goes in
`~/.claude/rules/local.md`, which is loaded as a user rule and never tracked.

**`settings.json` is not tracked.** Claude Code writes it itself (an "always allow" at user
level, `/config`, a plugin enable), so a tracked copy would differ on every machine and pulls
would conflict. `global-sync.cjs` merges the entries in `settings.global.json` into it instead:
it owns only hook entries whose command points into `$HOME/.claude/hooks/`, replaces those, and
leaves every other key alone. Changed hook settings apply from the next session, because a
session reads its hooks at start.

## 6. Updates: `global-sync.cjs`

Registered as a user-level `SessionStart` hook (matcher `startup`), timeout 10 seconds. It never
fails a session: every path exits 0.

1. `git ls-remote --tags origin 'v*'`: one small request; picks the highest tag.
2. If it equals the checked-out tag: nothing to do.
3. Otherwise: `git fetch --depth 1 origin tag <new>`, `git checkout --detach <new>`, merge
   `settings.global.json`, and print the new `CLAUDE.md` to stdout with one line,
   `Global rules updated v<old> -> v<new>; this text replaces the v<old> text loaded at start.`
   Claude Code adds a `SessionStart` hook's stdout to the context, so the session already runs on
   the new rules. (*Unverified:* whether a `CLAUDE.md` changed by the hook is reloaded anyway; if
   it is, the print is dropped.)
4. If the network fails: print `Global rules: could not check for updates; using
   v<current>.` and stop.

**A tag is a release.** Pushing `v2026.10.12` reaches every session at its next start, on every
machine. So:

- `scripts/release.sh` is the only way to tag: it writes the stamp into line 1 of `CLAUDE.md`,
  runs the tests, commits, tags. A CI check on tag push fails when the stamp and the tag differ.
- A tag ruleset on GitHub lets only Kade create `v*` tags, and `main` requires a PR.
- `global-sync.cjs` is the one file whose bug could stop updates everywhere, since it updates
  itself. It stays small, has the most tests, and every release is first tried in one session
  before Kade relies on it. Recovery by hand: `git -C ~/.claude checkout --detach <good tag>`
  locally; bump the tag in the cloud setup script.

**Cloud caching.** The cloud caches the setup script's result and reruns it only when the script
or the allowed hosts change, or after about seven days. Every cloud session therefore starts from
the cached tag and `global-sync` moves it forward, about a second or two per session, and the
first turn holds both the old and the new text (~1,000 extra tokens) until the cache refreshes.
Bumping the tag in the setup script after a release refreshes the cache; it is optional.

## 7. Setup

**Local, once per machine (PC, then Mac):**

```bash
cd ~/.claude
mkdir -p rules
[ -f CLAUDE.md ] && mv CLAUDE.md rules/local.md     # keep personal lines as an untracked rule
git init -q
git remote add origin https://github.com/enjay27/claude-global
git sparse-checkout set --no-cone /CLAUDE.md /rules/ /hooks/ /settings.global.json /.gitignore /.gitattributes
git fetch --depth 1 origin tag v<latest>
git checkout -q --detach v<latest>
git show HEAD:deploy-exclude > .git/info/exclude
node hooks/global-sync.cjs --install      # registers itself and context-guard in settings.json
```

On Windows, from Git Bash. `git init` in a folder that already has files is safe here: nothing
is tracked until the checkout, and the allowlist keeps everything else untracked. `global-sync`
rewrites `.git/info/exclude` from `deploy-exclude` on every update.

**Cloud, in the environment's setup script** (`setup/cloud-setup.sh`):

```bash
tag=v2026.10.09     # floor for new sessions; global-sync moves past it
c="$HOME/.claude"
mkdir -p "$c" && cd "$c" || exit 0
[ -d .git ] || git init -q
git remote get-url origin >/dev/null 2>&1 \
  || git remote add origin https://github.com/enjay27/claude-global
git sparse-checkout set --no-cone /CLAUDE.md /rules/ /hooks/ /settings.global.json /.gitignore /.gitattributes
if git fetch -q --depth 1 origin tag "$tag" && git checkout -q --detach "$tag"; then
  git show HEAD:deploy-exclude > .git/info/exclude
  node hooks/global-sync.cjs --install
else
  echo "GLOBAL RULES FAILED TO LOAD ($tag). Tell Kade before doing anything else." > CLAUDE.md
fi
exit 0
```

- No token: the repository is public, so the fetch is anonymous. (The setup script runs before
  the session connects to the GitHub proxy, so a private repository would have needed a token
  stored in the environment, readable by every session.) The environment must allow
  `github.com` in its network settings.
- The script fails soft: with `set -e`, a GitHub outage would stop every session in the
  environment from starting. The fallback file makes the failure the first thing the session
  says.
- The cloud `~/.claude` is not empty: the platform keeps `skills/`, `plugins/`, `projects/`,
  policy files and its own hook scripts there (seen in a cloud session on 2026-10-09). The
  sparse, allowlisted checkout leaves all of them untracked and untouched.

## 8. Steps

0. **Create `claude-global`** (Kade creates the empty public repository, then turns on secret scanning with push protection and the tag ruleset). Move `hooks/`,
   `docs/global-rules-plan.md` and `docs/refactor-plan.md` from here, with a commit that names
   the source commit. Split the README. `claude-skills` keeps `skills/`, `scripts/` and the skill
   docs.
1. **Prove the cloud** in a throwaway environment, before anything else depends on it:
   - the setup script above, with a test `CLAUDE.md`: `/context` lists `/root/.claude/CLAUDE.md`;
   - the platform's files in `~/.claude` are untouched, and `git status` there is clean;
   - a user-level `settings.json` written by the script is honoured: a test `SessionStart` hook
     in it runs;
   - a hook can reach `github.com`, so `global-sync` can fetch;
   - `github.com` is allowed in the network settings.

   If user-level hooks do not run in the cloud, the fallback is one line in each repository's
   `.claude/settings.json` that runs `node "$HOME/.claude/hooks/global-sync.cjs"`: a copy per
   repository, but one that never changes.
2. **Write `global-sync.cjs` test-first**, in the style of `context-guard.test.cjs`: same tag, new
   tag, fetch failure, settings merge keeps foreign keys, settings merge is
   idempotent, `--install` on an empty and on an existing `settings.json`. Plus the allowlist test
   and the stamp test.
3. **Draft the global `CLAUDE.md`**: the few rules that must always apply (coding conventions;
   the order plan, test, gate, commit; where state is recorded; the Windows shell traps), and a
   note on what each line replaced. List the candidates from repository `CLAUDE.md` files and
   `kade-workflow` first and let Kade confirm each. Under 60 lines.
4. **First release** with `scripts/release.sh`; set up the PC, then the Mac (section 7).
5. **Move context-guard to user level.** Change its paths from `$CLAUDE_PROJECT_DIR/.claude/hooks`
   to `$HOME/.claude/hooks`, then remove the vendored copy and its settings entry from each
   repository in the same PR, so it never fires twice. One PR per repository.
6. **Cut the duplicates** from repository `CLAUDE.md` files and `kade-workflow` once the global
   text is verified in a live cloud session, and add the "Overrides of global rules" section where
   needed. One PR per repository.

## 9. Open questions

| Question | How to check | Status |
|---|---|---|
| Can the setup script fetch the repository? | Step 1 | Public, so an anonymous fetch; only the network allowlist can block it |
| Does the cloud environment allow `github.com`? | Step 1 | Open |
| Is `~/.claude/CLAUDE.md` read in a cloud session started after the script? | `/context`, step 1 | Docs: yes |
| Do user-level `settings.json` hooks run in the cloud, next to the platform's own hooks? | Step 1 | Open; fallback in step 1 |
| Can a hook reach `github.com` in the cloud? | Step 1 | Open |
| Is a `CLAUDE.md` changed by a `SessionStart` hook reloaded in that session? | Change it in a test hook, ask for the stamp | Open; decides whether step 3 of section 6 prints |
| Do `paths:` rules work at user level? | One test rule in `rules/` | Open; the docs show `paths:` for project rules only |
| How do `$HOME` hook commands run on Windows? | context-guard live check in `stella-rain/app#5`, then the PC in step 4 | Open |

## 10. How it is tested

Same bar as the skills: write the checks first. Each check asks the session to quote the version
stamp, `Global rules: v<tag>`, so the answer is exact and also shows a stale checkout.

- A fresh cloud session on `app` quotes the stamp of the latest tag (fails today).
- A fresh local session on the PC and one on the Mac do the same.
- After a new tag is pushed, the next session on each machine quotes the new stamp without any
  manual step.
- A broken setup (wrong tag) starts the session and makes it report "GLOBAL RULES FAILED TO LOAD"
  first. With `github.com` unreachable, `global-sync` reports "could not check for updates".
- `git status` in `~/.claude` is clean after a week of normal use on each machine (the allowlist
  holds, nothing Claude Code writes is tracked).
- After step 6, the same sessions still work with the duplicates removed.

## 11. Risks

- **One tag reaches every session.** Mitigation: `main` needs a PR, only Kade can create `v*`
  tags, `release.sh` runs the tests, and each release is tried in one session first.
- **A bad `global-sync.cjs` cannot repair itself.** Mitigation: small file, most tests, the manual
  recovery in section 6, and the setup script's tag as a floor in the cloud.
- **Private files from `~/.claude` pushed to a public repository.** Mitigation: the allowlist, the
  test on it, secret scanning with push protection, and `~/.claude` is never a working copy:
  commits happen only in the development clone.
- **Always-on text costs attention.** Mitigation: the 60-line cap and a review of each line
  against "would a missed rule cost a failed command or a wrong PR".

## 12. Sources (Claude Code docs, read 2026-10-09)

| Fact used above | Page |
|---|---|
| Plugins cannot ship `CLAUDE.md`; a plugin `SessionStart` hook can add text to context and refires on `compact` | `code.claude.com/docs/en/plugins/components`, `/hooks` |
| A `SessionStart` hook's plain-text stdout is added to Claude's context | `/hooks` |
| Cloud sessions do not install plugins a repository enables, nor its extra marketplaces | `/cloud-environments` ("What carries over"), `/plugins/loading` |
| Setup script runs before Claude Code launches; writing `~/.claude/CLAUDE.md` there loads it; check with `/context` | `/cloud-environments` ("Setup scripts") |
| Setup script is cached; reruns when the script or allowed hosts change, or after about seven days; must exit 0 | `/cloud-environments` |
| The agent proxy connects after the setup script (why a private repository would need a stored token) | `/cloud-environments` |
| `~/.claude/rules/*.md` exists and loads before project rules; `@~/…` imports are allowed | `/memory` |
