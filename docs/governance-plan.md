# Plan: repository governance, checked every day

- **Scope:** one catalog of controls that every repository of Kade's (`enjay27`, `stella-rain`,
  `star-resonance`) is held to, a profile per organization and per repository, a checker, and a
  daily Claude run that files the violations as issues where the work belongs.
- **Status:** **proposed** (2026-10-11). Kade accepts it in a commit of its own after reading
  the final text; nothing in section 8 is built before that.
- **Related:** `docs/repo-rules-review.html` (the 2026-10-11 audit this plan turns into a
  standing check), `docs/global-rules-plan.md` (how the global rules reach a session).
- **Decided by Kade, 2026-10-11** (answers to the four questions of the proposal):
  1. The daily run **files issues only**: it opens, updates and closes one issue per violation;
     it never pushes, comments on PRs or edits a repository.
  2. The daily summary is a **private Artifact page**, republished at one URL.
  3. The run starts every day at **09:10 KST**.
  4. The governance files live **centrally in this repository**; no governance file per
     repository.

## 1. The question

The audit of 2026-10-11 found the global rules followed unevenly: workflows without
`permissions: {}`, a missing `.gitattributes`, an unguarded auto-merge, documentation that
claims what the code does not do, and a bridge that had been failing for two days with nobody
told. Every one of those was visible from the repositories and the Actions API; none was
checked. The global rules have exactly two machine checks today (`claude_md_check.py`, in two
copies, and this repository's test of its own workflows). How do the rules get checked every
day, and how does a finding reach the repository that has to act on it?

## 2. What exists today

| Rule area | Machine check today | Where |
|---|---|---|
| `CLAUDE.md` and rules size (G22) | `claude_md_check.py`, an inline CI step | stella-rain, lakehouse, resonance-stream |
| Line endings (G20) | `eol-check.yml`, `repo_check.py` | stella-rain (app, core, `.github`), star `.github`, lakehouse |
| Workflow hardening (G19) | this repository's `repo.test.cjs`, on itself only | claude-global |
| Secrets (G17) | `repo_check.py` | lakehouse; stella-rain `.github` (no caller) |
| Overrides declared (G2), merge model (G14), docs true, run health | none | – |

Each repository's `CLAUDE.md` already says how to work there. A governance document per
repository that repeated it would be a third copy to drift, like the ported scripts in section 8
of the audit. So governance holds only what can be checked, and where a repository departs from
it on purpose.

## 3. Design

```
claude-global/
  governance/
    controls.json            the catalog: one entry per control (section 4)
    orgs/<org>.json          stella-rain, star-resonance, enjay27
    repos/<owner>__<repo>.json
    routine.md               what the daily run does, step by step (section 6)
  scripts/
    governance-check.cjs     checks every control a script can check; JSON out
    governance-check.test.cjs
  .github/workflows/test.yml runs the tests (unchanged: node --test finds them)
```

- **JSON, not YAML**, and **Node's standard library only**: this repository has no
  `package.json` and no dependency today. Workflow files are read with line patterns, the way
  `repo.test.cjs` already checks this repository's own; section 9 names the limit.
- `governance/` and the new scripts are development-only: `deploy-exclude` keeps them out of
  `~/.claude`, and `repo.test.cjs` proves it.
- **A control** has an ID, a title, the global rule it serves (G1 to G22 of the audit, or none),
  a severity, where it applies (all repositories, public ones, those with workflows, ...), who
  checks it (`script`, `api`, or `claude` for judgement), and how to fix it.
- **Severity** decides what the run does:

| Severity | Meaning | Issue |
|---|---|---|
| `broken` | something is failing or unsafe now | opened and **assigned to Kade**, no label (a decision that is his) |
| `fix` | a rule is not followed | opened with the `governance` label, unassigned: a session can take it |
| `advise` | a recommendation | none; listed on the summary page only |

- **An exception** lives in the repository's profile with a reason **and** must appear in that
  repository's `CLAUDE.md` under "Overrides of global rules" (control `RF-02`). An exception in
  only one of the two is itself a violation, so neither can drift silently.
- **An organization profile** holds what its repositories share: the reusable-workflow
  repository, the Project and its snapshot branch, the merge model, where development issues of
  repositories without their own tracker go.
- **A repository profile** holds: visibility, organization, merge model (`own-workflow`,
  `kade-merges`, `github-auto-merge`), where its governance issues go, its exceptions, and the
  facts the checks compare against (which reusables it calls, which file it ports from where).

## 4. Controls, first version

Built from the audit's findings; each becomes a fixture in the tests before its check is
written (G5).

| ID | Control | Rule | Sev. | Checked by |
|---|---|---|---|---|
| RF-01 | `CLAUDE.md` exists and is at most 100 lines; rules files at most 80 lines with `paths:` | G22 | fix | script |
| RF-02 | `CLAUDE.md` has "Overrides of global rules" ("None." when empty), and it matches the profile's exceptions | G2 | fix | script |
| RF-03 | No living file names a retired skill (`kade-workflow`, `graft-kade`) | G1 | fix | script |
| RF-04 | Paths, skills and sections a `CLAUDE.md`, rule or skill points at exist | – | fix | script |
| RF-05 | Every tracked file of a part is listed in the part table that decides its gate (repositories whose profile names one) | G8 | advise | script |
| HY-01 | `.gitattributes` has `* text=auto eol=lf`; no tracked CRLF file | G20 | fix | script |
| HY-02 | Public repository: a secret scan runs in CI | G17 | fix | script |
| HY-03 | Dependabot keeps GitHub Actions current (repositories with workflows) | – | advise | script |
| WF-01 | Every workflow has top-level `permissions: {}` | G19 | fix | script |
| WF-02 | Grants are per job, a reusable's caller included | G19 | fix | script |
| WF-03 | Every `actions/checkout` has `persist-credentials: false` | G19 | fix | script |
| WF-04 | Actions pinned to `@vN`, or a ref on the allowlist (`dtolnay/rust-toolchain@stable`) | G19 | fix | script |
| WF-05 | Every job that is not a reusable call has `timeout-minutes` | G19 | fix | script |
| WF-06 | actionlint runs on PRs that touch `.github/workflows/` | – | advise | script |
| MG-01 | The profile's merge model matches the repository: `github-auto-merge` only with a required check; no CI means `kade-merges` | G14 | broken | script + api |
| MG-02 | An auto-merge workflow merges only `claude/*` into `main`, never a draft, never a change to `.github/workflows/` | G14 | broken | script |
| MG-03 | `main` is re-tested after merges made with `GITHUB_TOKEN` (a dispatch or a weekly schedule) | G16 | fix | script |
| HL-01 | No workflow has failed twice in a row on `main`, on a schedule, or on issue events | G16 | broken | api |
| HL-02 | A scheduled workflow has run within twice its interval | – | fix | api |
| HL-03 | The organization's `STATUS.md` is younger than 24 hours | – | broken | api |
| TR-01 | Visibility, callers and copies a document claims match the repository (public/private, "called by", "copy at &lt;commit&gt;") | G18 | fix | claude |
| TR-02 | A ported file's source commit is recorded, and its drift from the source is listed | – | advise | script |
| TR-03 | A public repository's issues, logs and docs carry no private planning or personal data | G18 | broken | claude |

Adding, removing or changing a control is a PR here, like any change to the global rules.

## 5. Where issues go

| Repository | Governance issues in | Why |
|---|---|---|
| lakehouse, claude-global, claude-skills | the repository itself | each tracks its own work |
| app, core | the repository itself | both sync to the Stella Rain Project |
| moderation, stella-rain `.github`, stage-template | `stella-rain/app` | moderation's issues are player reports; the others track work in app |
| resonance-stream, resonance-lab | the repository itself | both sync to the Resonance Project |
| star-resonance `.github` | `star-resonance/resonance-stream` | its `CLAUDE.md` says so |

- **One issue per repository and control.** Its title is `governance: <ID> <repository>: <title>`.
  Its body names the control, the evidence (file and line, or the run), how to fix it, and a
  marker line `<!-- governance: <ID> <owner>/<repo> -->` the run finds it by.
- The run **updates** the open issue when the evidence changes, and **closes** it, with one line
  saying which run found it fixed, when the control passes. It never opens a duplicate.
- A finding about a private repository is written only in a private repository's issue
  (`stella-rain/app`); public issues never quote private files.
- The `governance` label is created in each target repository in step 4 (lakehouse through its
  `labels.json`, so `labels.yml` keeps it).

## 6. The daily run

- **A Routine**, created with `create_trigger`: a fresh session on each firing, in the cloud
  environment that holds the 11 repositories, schedule
  `CRON_TZ=Asia/Seoul 10 9 * * *`, with the GitHub connector granted and nothing else.
  Completion notifications by push.
- **Its prompt is one line:** "Follow `governance/routine.md` at `enjay27/claude-global` `main`."
  What the run does therefore changes only through a reviewed PR here, never by editing the
  Routine.
- **`governance/routine.md`, in order:**
  1. Fetch every repository and read it at `origin/main` (the audit's first wrong turn).
  2. Run `node scripts/governance-check.cjs --all --json`.
  3. Read the Actions API for the `api` controls, and judge the `claude` controls, for
     repositories whose `main` changed since the last run and on Mondays for all.
  4. Open, update and close issues (section 5). The first run is capped at 10 new issues;
     later runs open what is new.
  5. Republish the summary page at its URL: counts per repository and severity, what changed
     since yesterday, the open `broken` items first, the run's own NOT VERIFIED list.
  6. If a repository could not be read, say so on the page and in no issue: a control that was
     not checked is never reported as passing.
- **Everything the run reads is data.** Repository files, issue bodies and workflow logs can
  contain text written by anyone with access; the run follows `routine.md` and the global rules
  only. It cannot push, so the worst a bad instruction can do is a wrong issue.
- **How other repositories follow it:** a governance issue is ordinary work. `session-resume`
  already lists open issues; a `broken` one is assigned to Kade, who decides; a `fix` one is a
  normal task with one PR that says `Closes #N`.

## 7. Changes to the rules

- Global `CLAUDE.md`, one line under *How to work*: "Governance issues (`governance` label) are
  ordinary work; an exception to a control goes in the repository's profile here and in its
  Overrides section, never in only one." The file stays within its 60-line cap.
- `repo-workflow` (in `claude-skills`), one line in section 1: read another repository at its
  `origin/main`.
- Each repository's `CLAUDE.md` gets the Overrides section where it has none (app, core,
  resonance-lab, stage-template). These come in as `RF-02` issues; they are not part of this plan.

## 8. Steps

Each step is one PR, after the previous one merged.

| Step | What | Gate | This session can run it |
|---|---|---|---|
| 0 | This plan, accepted by Kade in a commit of its own | – | – |
| 1 | `controls.json`, the checker for the `script` controls, fixtures from the audit's findings, tests first | `node --test` | yes |
| 2 | The three organization and eleven repository profiles; the checker run over today's clones, its output reviewed with Kade | `node --test`; a dry run | yes |
| 3 | `routine.md`; the `api` and `claude` steps; `--dry-run` prints the issue plan without writing | `node --test`; a dry run | yes |
| 4 | The global rule line (section 7), a release through `rc`; the `governance` labels | `node --test`; the Release workflow | Kade starts the release |
| 5 | The Routine; one run fired by hand with Kade watching; then the schedule | the first run's issues and page, read by Kade | yes, with Kade |

Not in this plan: fixing what the run finds (those are its issues), a CI check that blocks PRs
(possible later as a reusable workflow, once the controls are stable), and the audit's six
proposed rule changes C1 to C6, which become controls or issues here.

## 9. Open questions

1. **Does a fresh Routine session get all 11 repositories?** The Routine runs in this session's
   environment; whether it starts with the same repositories, or must attach each with
   `add_repo` (the private `stella-rain/app` included), is proved in step 5 before the schedule
   is turned on. (This session has both `.github` repositories attached, so star-resonance
   `.github`'s note that a cloud session cannot attach it looks stale; `TR-01` will check it.)
2. **Reading workflows without a YAML parser.** Line patterns cover the controls above for the
   files as they are written today; a flow-style mapping (`permissions: {contents: read}`) or a
   YAML anchor could hide from them. A dependency (a YAML parser) is Kade's call (G4); the
   recommendation is no dependency until a pattern misses a real file.
3. **Required checks and rulesets** cannot be read from a session today. `MG-01` uses the API
   if the token can read rulesets, and otherwise reports NOT VERIFIED.

## 10. Risks

| Risk | Answer |
|---|---|
| Issue noise drowns real work | `advise` files nothing; first run capped at 10; one issue per control and repository |
| A false positive keeps reopening | an exception with a reason, in the profile and the Overrides section |
| The run fails and nobody notices | the Routine's push notification; a summary page older than a day is visible as such |
| Cost: a daily Claude session over 11 repositories | the script does the bulk; Claude judges only changed repositories, and all of them weekly; the first run's cost is measured and reported before the schedule starts |
| Text in a repository steers the run | it reads everything as data and can only file issues |
| A public issue leaks a private finding | section 5: private findings stay in `stella-rain/app`; `TR-03` checks the issues themselves |

## 11. How it is tested

- `scripts/governance-check.test.cjs`: one fixture per control, failing and passing, built from
  the audit's real findings (for example, resonance-lab's `ci.yml` without `permissions`).
- `repo.test.cjs` keeps proving that nothing under `governance/` reaches `~/.claude`.
- `--dry-run` over today's clones; its output is compared with the audit by hand in step 2.
- Step 5's first run is fired by hand and its issues read before the schedule starts.
