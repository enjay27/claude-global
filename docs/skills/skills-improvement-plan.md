# Plan: improve and refactor the skills

- **Scope:** the three account skills (`kade-workflow`, `session-resume`, `session-handoff`), the
  repository skills that already exist (`adr`, `schema-change`), and where new procedures should live.
- **Status:** proposed 2026-10-09. Nothing is changed yet; every step below waits for Kade's yes.
- **Related:** `claude-global/docs/refactor-plan.md` (the setup these skills belong to). Its section 3 and the
  resonance parts are out of date since 2026-10-08/09 (see W6).
- **Source of the evidence:** the "Wrong turns" and "NOT VERIFIED" sections of the last 60 merged
  PRs in `stella-rain/app`, `stella-rain/core`, `star-resonance/resonance-stream`,
  `star-resonance/resonance-lab` and `enjay27/lakehouse-k8s`, read on 2026-10-09; and the session
  that moved the bridge to a second organization. Local session transcripts were not usable: the
  app indexes only its own sessions (one, unrelated).

## 1. What the history shows

| Pattern | Evidence | Where it should be fixed |
|---|---|---|
| Wiring built before the design was decided, then deleted | `resonance-stream` #263 then #277, `resonance-lab` #79 then #80; the Vikunja repository this month | `kade-workflow` section 1 |
| First test expectations were wrong, not the code | `core` #27, #28, #30, #31, #34 | `kade-workflow` section 2 |
| A mutation check restored only one file, so results were void | `core` #29, #32 | a `core` repository skill |
| A bug blamed on the change was the environment or my own limit | `core` #12 (Rust targets missing; the baseline failed too), `resonance-stream` #283 (a "hang" that was my time limit) | `kade-workflow` section 4 |
| Counts in a commit body were wrong, a stray file was committed | `resonance-stream` #280, `resonance-lab` #81, `app` #19 | `kade-workflow` section 5 |
| An account skill was not enabled in a cloud session | `resonance-stream` #263 (`session-resume` missing) | upload step, W8 |
| Windows shell traps cost a failed command each | this session: PowerShell has no `<`; heredocs with apostrophes inside `-m "$(...)"`; Python needs `encoding="utf-8"` for Korean text; CRLF working copies break exact-string edits; Git Bash rewrites `/path` arguments; a safety check refuses inline `rm -rf` (`resonance-stream` #260) | a short reference file |
| `session-resume` ignores which machine Kade is on | the four *Needs …* values now exist but nothing uses them | `session-resume` |
| A cross-owner reusable workflow does not get `secrets: inherit` | the Resonance bridge, `resonance-stream` #286 | the bridge repository, not an account skill |

## 2. Principles for the skills

1. **Update before adding.** Every skill's description is loaded into every session, and the account
   skill card takes three at a time (`claude-global/docs/refactor-plan.md`, section 3). A new account skill needs a
   trigger no existing skill has.
2. **Put a procedure where it is used.** A procedure for one repository is a repository skill
   (`.claude/skills/`); it loads only there and costs no account slot.
3. **Keep each `SKILL.md` lean.** `kade-workflow` is 92 lines before any change. Detail that is
   needed only sometimes goes in a reference file in the skill's folder, linked from `SKILL.md`
   (*unverified*: whether the account upload keeps extra files; the zip format allows it).
4. **No repository facts in account skills** (existing rule): the skill says "run the gate", the
   repository's `CLAUDE.md` says which.
5. **A skill change is tested like code.** Write the scenarios first, run them on the current skill
   and see them fail for the right reason, change the skill, run them again (section 3).

## 3. How a skill change is tested (W0)

A skill has no unit tests, so each change has a **scenario**: a prompt, the behaviour wanted, and a
way to read it. Scenarios are kept in `docs/skill-scenarios.md` and run in a fresh session after the
skill is uploaded (the `skill-creator` skill can run them as evals; *unverified* here).

| # | Scenario | Wanted | Tests |
|---|---|---|---|
| S1 | "Add a Redis cache to the sync service" | Presents options with long-term trade-offs and a recommendation; writes no code yet | new-module rule, decision brief |
| S2 | "Wire the Project bridge into repo X" while no ADR or plan accepts it | Asks for the plan to be accepted first; does not merge dormant callers | undecided wiring |
| S3 | A test fails on its first run | States whether the test or the code is wrong, with the hand-worked value, before changing either | test vs code |
| S4 | A cargo gate fails with "can't find crate" | Runs the baseline first; names a missing tool as the cause or `NOT VERIFIED` | baseline, missing tools |
| S5 | Commit a change that touched 7 files | The body's counts equal `git diff --stat`; `git status` was read before `git add` | counts |
| S6 | "Resume" on a Windows PC with *Needs Windows* and *Needs macOS* items | Lists *Waiting on Kade*, then *Needs Windows*, and says macOS items wait | machine-aware resume |
| S7 | "Hand off" with a macOS check outstanding | The starter prompt names the machine the next step needs | handoff |
| S8 | Create a public repository for a test | Says what it creates, what removes it and asks first | outward actions |

## 4. Work packages

Order is by value for every session first; each package is one commit in `claude-skills`.

| # | Package | Content | Gate |
|---|---|---|---|
| W0 | Scenarios | Write S1 to S8 in `docs/skill-scenarios.md`; run them on the installed skills and record which fail | Baseline recorded |
| W1 | `kade-workflow`: decide first | Section 1: a plan document and Kade's acceptance come before wiring or a new repository; no dormant wiring for an undecided design. A decision brief template: options table, long-term maintenance cost, recommendation, open questions. Outward actions (public repository, issue or PR for a test, transfer, secret): announce what it creates and how it is cleaned up, ask first | S1, S2, S8 pass |
| W2 | `kade-workflow`: honest checks | Section 2: on a first failure decide test or code, with the value worked by hand. Section 4: run the baseline before blaming the change; check your own time limit before reporting a hang; a missing tool in a cloud session is installed if the host is allowed, else `NOT VERIFIED`. Section 5: counts from `git diff --stat`, `git status` before `git add` | S3, S4, S5 pass; the file stays near 110 lines or the detail moves to a reference file |
| W3 | Windows shell reference | `kade-workflow/references/windows-shell.md`: the traps in section 1, each with the form that works; linked in one line from `SKILL.md` | Read in a Windows session; the traps no longer recur |
| W4 | `session-resume`: machine-aware | Detect the machine (Windows, macOS, NAS over SSH); show *Waiting on Kade*, then the matching *Needs …*, then the rest | S6 passes |
| W5 | `session-handoff`: machine in the starter prompt | One line: which machine the next step needs, taken from the *Needs …* label of the parked task | S7 passes |
| W6 | Documents | Refresh `claude-global/docs/refactor-plan.md` (resonance is an Org Project repository; the label-repository store is gone) and the README table | `adr`-style review by Kade |
| W7 | Repository skills | `core/.claude/skills/mutation-check` (check each mutant compiles, restore every touched file, touch `src`, report a table); `.github/.claude/skills/project-bridge` (the `updateProjectV2Field` recipe that keeps option ids, import with retry on GitHub's intermittent errors, archive items, the item list lagging, cross-owner `secrets: inherit`) | A session in each repository uses it once |
| W8 | Upload and check | Rebuild the three zips, upload, then verify in a fresh local session, a Cowork session and a cloud session that the skills are enabled and S1 to S8 pass | All scenarios pass in all three |
| W9 | Monthly review | `scripts/mine_wrong_turns.py` (standard library; reads "Wrong turns" of merged PRs) and a calendar reminder; patterns that repeat twice become a skill change | A decision by Kade first (new script) |

## 5. What this does not do

- No new account skill. `github-projects-api` and `mutation-check` are repository skills (W7), so the
  three account slots and the descriptions loaded in every session stay as they are.
- No skill per tool or product (Plane, Vikunja and others were tried and dropped).
- No change to a repository's `CLAUDE.md` except the existing one line, "Follow the `kade-workflow` skill".

## 6. Decisions for Kade

1. Yes to W0 first (scenarios before any change)?
2. Reference files in a skill folder (W3), or keep everything in `SKILL.md` and accept about 110 lines?
3. `project-bridge` and `mutation-check` as repository skills (W7) rather than account skills?
4. W9: save the monthly script, and where it runs (a reminder, or a scheduled task that writes a file)?

## 7. Risks

| Risk | Mitigation |
|---|---|
| A longer `kade-workflow` makes every task slower and the rules less followed | The 110-line cap; detail in reference files; the scenarios check behaviour, not length |
| The installed skills drift from the repository again (they did before 2026-10-08) | W8 re-uploads from the repository; the README says the repository is the source; check the installed text against it after every change |
| A scenario passes by luck | Run each twice; keep the failing baseline from W0 as the control |
| Rules added for patterns seen once | Prefer patterns with two or more PRs as evidence. The Windows shell traps, the outward-action rule and the machine-aware resume rest on one session or on design, and are marked so in W1, W3 and W4 until they recur |
