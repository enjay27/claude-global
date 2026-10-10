# Plan: refactor the Claude configuration across repositories

- **Scope:** `CLAUDE.md`, `MEMORY.md`, `.memory/`, `.claude/skills/`, `.claude/rules/`, CI checks,
  in `resonance-stream`, `lakehouse-k8s` and the new Stella Rain repositories
- **Related:** Stella Rain ADR-031 and `app/docs/plans/project-bridge.md`
- **Status:** accepted 2026-10-08 (decisions in section 9)
- **Canonical copy:** this file, in `enjay27/claude-global` (moved from `enjay27/claude-skills` on
  2026-10-09, which now holds the account skills only). Repositories link here rather than keep their
  own copy. Sections 7 to 9 are a record and keep the names used at the time.

## 1. Why

Measured on 2026-10-08:

| | resonance-stream | lakehouse-k8s |
|---|---|---|
| `CLAUDE.md` (loaded every session) | 321 lines, 21 KB | 330 lines, 18 KB |
| `MEMORY.md` | 31 lines but 5.3 of 6 KB; longest line 1,441 chars | 73 lines (own limit: 40) |
| `MEMORY.md` imported by `CLAUDE.md` | no | no |
| `.memory/` | 440 KB, 20 session files incl. 8 handoffs | 1.2 MB, 41 session files, active issues 183 KB + 111 KB |
| Enforcement | CI checks `MEMORY.md` size | none |

Claude Code's documentation recommends keeping each `CLAUDE.md` under 200 lines and says longer
files reduce how well instructions are followed. Both are past that, mostly with content that
matters only some of the time: release procedures, one half of the repository, dated history.

What already works and stays: the rules/state/detail split, findings-style commit messages,
`NOT VERIFIED`, per-part gates, CI enforcement (resonance-stream), the decision log, graft.

## 2. Principles

1. **One home per kind of knowledge, chosen by how long it stays true.**

   | Kind | Home |
   |---|---|
   | Rules for this repository | `CLAUDE.md`, **at most 100 lines** |
   | Rules for one part of the repository | `.claude/rules/<part>.md` with `paths:` (loads only when those files are touched) |
   | Procedures (release, schema change, ADR) | Repository skills (load only when used) |
   | Kade's way of working, all repositories | **Account skills** on claude.ai (available in cloud, Cowork and terminal sessions) |
   | Automatic warnings and checks inside a session | **Hooks**, vendored from `enjay27/claude-global` into each repository's `.claude/hooks/` (moving to user level: `docs/global-rules-plan.md`) |
   | Why it is like this | ADRs (Stella Rain) or `docs/decisions.md` (resonance-stream) |
   | Tasks, bugs, unverified items, roadmap | Org Project (Stella Rain); labelled issues read over REST (resonance-stream, resonance-lab); `MEMORY.md` + `.memory/` until a repository migrates |
   | What one change did, what was verified, wrong turns | PR description (template) |

2. **No dates in rules.** "Until 2026-10-07 it was two types" is history; the rule is "one type,
   in `crates/types`". History goes to the decision log or git.
3. **Every limit is enforced by CI**, not by a sentence asking Claude to respect it.
4. **Behaviour-preserving moves first.** A move PR changes where text lives, not what it says.
   Wording changes come in a separate PR.

## 3. Account skills (shared by every repository)

Written once, saved to the claude.ai account (proposed through Claude, saved by Kade), with
their source kept in a private repository `enjay27/claude-skills` so changes are reviewable.

| Skill | Replaces | Content |
|---|---|---|
| `kade-workflow` | `workflow-control` in both repos; the Guardrails, Version Control and message-style sections | Plan first; test first; at most 2 self-corrections; gates for every part touched; `NOT VERIFIED`; never commit others' work; `git status` before `git add -A`; branch → PR → wait for merge, or local auto-commit, per the repo; commit subject and body style; PR sections; where state is recorded; the context budget rule |
| `session-resume` | "New session? Start with …" lines | Read the state (STATUS.md on the `status` branch, else `MEMORY.md`), open and recent PRs, current branch; summarize; propose the next task and wait |
| `session-handoff` | Handoff session files | Finish or park the task (`WIP:` commit on its branch), record state (labels or *Now*), then give Kade an 8-line starter prompt to paste into the new session |

Commit and PR style are part of `kade-workflow` rather than a fourth skill: they are always
needed together, and the account skill card takes three at a time.

Source: `skills/<name>/SKILL.md` in this repository. Saved to the account through Claude's
skill proposal card; to change one, edit the file here, then propose the updated file again.

Each repository's `CLAUDE.md` keeps one line: *"Follow the `kade-workflow` skill."* Skills are chosen by description, so the line makes it explicit, and CI still
enforces the outcomes.

Repo-specific facts never go into account skills (gates, paths, branch names). The skill says
"run the gate for every part touched"; the repository's `CLAUDE.md` says what the gates are.

## 3a. Context guard (hook)

Kade checks context size by hand today and starts a new session with a handoff. The hook makes
the check automatic in Claude Code sessions (terminal and cloud):

- Hooks receive no context usage, but they receive `transcript_path`, and every assistant entry
  there carries the request's `usage`. Input + cache creation + cache read is the same number the
  status line shows as context used.
- **UserPromptSubmit:** at **300k tokens** Claude answers, then adds one line with the number; at
  **400k** it stops before the prompt's work, recommends a handoff, and offers three choices: handoff and
  a new session (`session-handoff`), `/compact` with a focus, or continue. Kade also sees a
  one-line warning. Each level fires once, and re-arms when usage drops after a compaction.
- **SessionStart, matcher `compact`:** right after a compaction, Claude says so and offers the
  same choices.
- The lines are token counts capped at a share of the window: warn at 300k but never later than
  40%, hand off at 400k but never later than 60% (a 200k-window model: 80k and 120k). The window
  defaults to 1M. All are environment variables (`CONTEXT_WARN_TOKENS`, `CONTEXT_HANDOFF_TOKENS`,
  `CONTEXT_WARN_PCT`, `CONTEXT_HANDOFF_PCT`, `CLAUDE_CONTEXT_WINDOW`).
- Why these numbers (Kade, 2026-10-08, changed from 60% / 80% of an assumed window): quality
  degrades gradually as context grows, and no vendor publishes a switch point. Anthropic calls it
  context rot ([context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows));
  Claude Code's [best practices](https://code.claude.com/docs/en/best-practices) say to `/clear`
  between unrelated tasks and to start fresh after two failed corrections; Chroma's
  [Context Rot](https://www.trychroma.com/research/context-rot) and
  [NoLiMa](https://arxiv.org/abs/2502.05167) measure the drop. Claude Code auto-compacts a 1M
  session at about 967k ([model config](https://code.claude.com/docs/en/model-config)), so a
  400k handoff comes long before it. Task boundaries come first (`kade-workflow` section 7); the
  hook is the backstop.
- It never blocks a prompt; on any error it is silent.

Files: `hooks/context-guard.cjs`, 14 tests in `hooks/context-guard.test.cjs`, and
`hooks/settings-snippet.json` to merge into a repository's `.claude/settings.json`.
Each repository vendors a copy at `.claude/hooks/context-guard.cjs`.

Not covered: sessions without Claude Code hooks (Cowork through the desktop app, chat). There,
`kade-workflow` section 7 asks Claude to offer a handoff after a compaction or a long session,
which is a judgement call rather than a measurement.

## 4. resonance-stream

### Where each section of `CLAUDE.md` goes

| Lines | Section | Destination | Lines kept in `CLAUDE.md` |
|---|---|---|---|
| 1–29 | What the app is, parts and gates table | stays; drop the 2026-09-29/10-07 history sentence | ~22 |
| 33–51 | Tech stack | condensed to one line per component; updater and gist details → `.claude/rules/app.md` | ~8 |
| 55–94 | Repository layout (40 lines) | top-level folders only; per-file detail is what graft is for | ~12 |
| 98–105 | Using graft | stays | ~5 |
| 109–119 | Conventions (app crate) | `.claude/rules/app.md`, `paths: src-tauri/**` | 0 |
| 121–137 | Conventions (ui crate) | `.claude/rules/ui.md`, `paths: src/**` | 0 |
| 139–173 | Guardrails | general ones → `kade-workflow`; refactors keep behaviour, credentials, TDD scope stay; "The runbook is docs" → `.claude/rules/runbook.md`, `paths: runbook/**` | ~10 |
| 177–188 | Definition of done | stays, shortened; UI preview rule → `rules/ui.md` | ~8 |
| 192–244 | Version control, several tasks in one session | general flow → `kade-workflow`; keep: "only `claude/*` auto-merges into `main`", `workflow_run` note | ~6 |
| 246–255 | Test branches | `release` skill | 0 |
| 257–315 | Release candidates, stable releases, release notes | `.claude/skills/release/SKILL.md` (`disable-model-invocation: true`), plus `.claude/rules/release.md` for `paths: .github/workflows/release*.yml, release-notes/**` | 2 (pointer) |
| 317–321 | Never commit | stays | ~5 |
| new | `@MEMORY.md` import; "Follow the `kade-workflow` skill" | | 3 |

**Result:** about 85 lines always loaded, down from 321. Nothing is deleted; everything else
loads when the files it concerns are touched, or when the release skill is invoked.

### MEMORY.md and .memory/

- `CLAUDE.md` imports `MEMORY.md` (`@MEMORY.md`), so *Now* is in every session without relying
  on Claude opening it.
- `memory-check.sh` adds a **200-character line limit** (closes the long-line loophole) and its
  test file gets a case for it.
- *Now* refers to decisions by ID only ("D-28 done; `metadata-v3` is Kade's"), never retells them.
- Handoff files stop. Their content goes to *Now* (next steps) and the PR's *Wrong turns*.
  Existing handoff files stay in `sessions/` as history.
- `docs/decisions.md` stays the decision log; resonance-stream does not need ADRs.
- `workflow-control` skill is removed after `kade-workflow` has been used for two weeks.
- `ui-preview` and `graft` skills stay.

### CI additions

- `claude-md-check.sh`: `CLAUDE.md` at most 100 lines; each `.claude/rules/*.md` at most 80
  lines and must have `paths:`; tested like `memory-check.sh`.

### PRs (each through the normal `claude/*` flow)

| PR | Content | Behaviour change |
|---|---|---|
| R1 | Create `.claude/rules/{app,ui,runbook,release}.md` and `.claude/skills/release/` by moving text verbatim; remove the moved text from `CLAUDE.md` | none |
| R2 | Trim `CLAUDE.md` (history out, layout to top level), add `@MEMORY.md` and the skills line | wording only |
| R3 | `memory-check.sh` line limit + test; `claude-md-check.sh` + test; wire into `ci.yml` | CI gets stricter |
| R4 | Shrink *Now* to one line per item; stop handoff files; vendor `context-guard` and merge its settings with the graft hooks | Claude warns at 200k / 400k tokens of context |
| R5 (after 2 weeks) | Remove `workflow-control` | none |

Bridge plan phase B5, **decided 2026-10-08: no Project for resonance.** A user-owned Project needs a
classic token (GitHub Apps and fine-grained tokens cannot reach one) plus a snapshot workflow. Instead
the state is issues with persistent labels (`status:now|next`, `verify:needs-kade|not-verified`), read
over repository-scoped REST, which cloud sessions can reach. *Now* keeps only what has no issue; after
a trial (until about 2026-10-22) it goes in its own PR. resonance-lab has the labels; moving its
*Now* into issues is a separate task.

## 5. lakehouse-k8s

Lower priority: a work-adjacent repository with a slower pace. Same pattern, larger move.

| Lines | Section | Destination |
|---|---|---|
| 1–14 | Two halves, gate per tree | stays |
| 18–50 | Tech stack, many dated facts | one line per component stays; dated facts (Polaris 1.6.0 since …, VictoriaLogs gone, file logging since …) → `.memory/environments-platform.md` |
| 54–90 | Layout | top level only |
| 94–124 | Environments, notebook import convention | `.claude/rules/suite.md` (`paths: src/**, tests/**, notebooks/**, diagnostics/**`) |
| 128–159 | Configuration and schema policy | `.claude/rules/platform.md` (`paths: charts/**, releases/**, logging/**, schema/**, runbooks/**`) |
| 163–185 | Commands, notebook practices | split between the two rules files |
| 189–214 | Guardrails | cluster-context, namespace, destructive-command and Cowork rules stay (they are safety-critical, always loaded); the rest → `kade-workflow` |
| 218–239 | Definition of done | stays, shortened |
| 243–314 | Version control (local auto-commit, lock files, identity) | general part → `kade-workflow`; lock-file and identity notes stay (specific to this mount) |
| 318–330 | Pre-merge history | `docs/MERGE-2026-09-21.md` already covers it; one pointer line stays |

Also: `MEMORY.md` back under 40 lines (*Now* only; the merge story is history), `@MEMORY.md`
import, archive the stale `repository-map-*.md` into `archive/` with their date (your
archive convention), and add the same two checks as a pre-commit hook or a small GitHub
Actions workflow.

PRs or commits: L1 move to rules (verbatim), L2 trim and import, L3 `MEMORY.md` and archive, L4 checks.

## 6. Stella Rain (pilot, built to the target from the start)

| Repository | `CLAUDE.md` (≤ 100 lines) | Rules | Skills | State |
|---|---|---|---|---|
| `app` | what it is, layout, gates (Godot headless, ADR checks), `@` none (state is in the Project), skills line | `godot.md` (`godot/**`), `adr.md` (`docs/adr/**`) | `adr`, `schema-change`, `release` (later) | Project via bridge |
| `core` | determinism rules summary, gates (fmt, clippy, test, replay corpus) | `determinism.md` (`src/**`) | `schema-change` (shared text with `app`) | Project via bridge; **public: no private plans in any file** |
| `stage-template` | short: it is copied by creators; keep it generic | none | none | none |
| `moderation` | short: blocklist format, report handling (ADR-025) | none | none | issues, not synced |
| `.github` | short: bridge script, tests, templates | none | none | none |

No `MEMORY.md` and no `.memory/` in any Stella Rain repository (ADR-031).

## 7. Order

| Step | Work | Depends on |
|---|---|---|
| 0 | Three account skills saved; `enjay27/claude-skills` created and pushed | done 2026-10-08 |
| 1 | Stella Rain pilot: bridge setup (runbook), then `CLAUDE.md`, rules, skills and `context-guard` for each repository | done 2026-10-08 (see below) |
| 2 | resonance-stream R1–R4, in a resonance-stream session | done 2026-10-08 (see below) |
| 3 | Two weeks of use; adjust the account skills | step 2 |
| 4 | resonance-stream R5; lakehouse-k8s L1–L4 | step 3 |

Step 1 as built in Stella Rain, to copy into resonance-stream R1–R4:

- `CLAUDE.md`: app 89, core 86, moderation 58, `.github` 52, stage-template 33 lines (written
  for creators, since every creator repository is a copy).
- The CLAUDE.md check is `scripts/claude_md_check.py` (17 tests) plus a reusable workflow in
  `stella-rain/.github`; four repositories call it. The same repository holds `eol-check.yml`:
  every repository has `.gitattributes` with `* text=auto eol=lf`, and CI fails on CRLF
  (added after Windows `core.autocrlf` warnings).
- The remote file tools cannot write `.github/`, `.claude/` or anything in a repository named
  `.github`; those files went over as zips that Kade extracted, and Kade committed `.github`.
- Not yet observed: `context-guard` and the path-scoped rules loading in a real Claude Code session.

Step 2 as built in resonance-stream (one PR each, all auto-merged on green CI, 2026-10-08):

| PR | Content | Result |
|---|---|---|
| #256 R1 | Sections moved verbatim to `.claude/rules/{app,ui,runbook,release}.md` and a `release` skill (model invocation left on: Claude runs the rc and `test/*` flows itself) | `CLAUDE.md` 321 → 217 lines |
| #257 R2 | Trim; `@MEMORY.md`; "Follow `kade-workflow`"; per-file layout moved to `rules/{core,ui,app}.md` instead of dropped (Kade) | 217 → 99 lines |
| #258 R3a | *Now* shrunk first, in its own PR, so the line-length check lands on a file that meets it (Kade split R3) | `MEMORY.md` 5,576 → 3,004 bytes |
| #259 R3b | `memory-check.sh` 200 characters a line (counted with `perl -CSD`: mawk counts bytes); `claude-md-check.sh` (bash, like the repo's other helpers, not the pilot's Python) | CI enforces both |
| #260 R4 | `context-guard` vendored beside the graft hooks (settings merged by code); its test also runs in CI; handoff files stop | |

- The work ran in a cloud session with the repository attached, so `.claude/` and `.github/` were
  pushed directly; the zip route is needed only for the desktop file tools.
- The `@MEMORY.md` import and the new `release` skill were picked up by the session at once.
- `claude-skills` needed the Claude GitHub app's repository access before a cloud session could read it.
- Not yet observed: the same two items as the pilot.
- Then, same day: the 200k / 400k hook in resonance-stream (#261; identical to this repository's copy;
  Stella Rain `app` #7 and `core` #4 wait for Kade). State moved to labelled issues (#277: issues
  #264-#276 replace *Now*'s items). Wrong turn: #263 and resonance-lab #79 added bridge callers for a
  user Project, removed unused by #277 and resonance-lab #80 once labels were chosen.

## 8. Risks

| Risk | Mitigation |
|---|---|
| A path-scoped rule does not load when needed (e.g. a task edits only CI files) | Safety-critical rules stay in `CLAUDE.md`; rules are scoped generously |
| Account skills are not visible to other contributors or tools | Source kept in `enjay27/claude-skills`; repository `CLAUDE.md` names them; CI enforces outcomes |
| A skill is not picked up automatically | The explicit line in `CLAUDE.md`; descriptions put the trigger first |
| Moving text loses meaning | Move verbatim first (R1, L1), reword later |
| Cowork desktop sessions differ from Claude Code | Account skills load in Cowork too; rules files are read when the repository is the working directory, otherwise the session reads `CLAUDE.md` explicitly |

## 9. Decisions (Kade, 2026-10-08)

1. **Yes:** a private `enjay27/claude-skills` repository holds the account skills, the hooks and this plan.
2. **Yes:** `CLAUDE.md` is limited to 100 lines, checked by CI.
3. **After the Stella Rain pilot:** resonance-stream R1–R4 run then, in a resonance-stream session.
4. Context guard added: warn at 60%, recommend a handoff at 80% (section 3a). Changed the same day:
   warn at 200k tokens, hand off at 400k, never later than 40% / 60% of the window.
