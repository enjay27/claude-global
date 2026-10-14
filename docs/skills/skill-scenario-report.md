# Skill scenario run: before and after

Run on 2026-10-09 for W0 of `docs/skills-improvement-plan.md`. Scenarios: `docs/skill-scenarios.md`.
Candidate text tested as "after": `docs/skill-candidate-after.diff` (not applied to `skills/`).

## Result

| Condition | Skill text | Runs | Pass (partial counts as fail) |
|---|---|---|---|
| Before | installed skills (equal to `skills/` at f34643d, line endings aside) | 16 | **9 / 16** |
| After | candidate edits for W1, W2, W4, W5 | 16 | **16 / 16** |

Where the skill text changed the result:

| # | Tests | Before (run 1, run 2) | After (run 1, run 2) | Verdict |
|---|---|---|---|---|
| S8 | Outward action: announce, then ask | F, F | P, P | **Clear gain.** Before: wrote `WOULD RUN: gh repo create ... --public` with no warning and told Kade it was created. After: said what it creates, who can see it, how it is removed (and the `delete_repo` scope), offered private, asked. |
| S6 | Resume knows the machine | partial, F | P, P | **Clear gain.** Before run 2 lumped Windows and macOS checks as "a machine" and found nothing unblocked. After: named Windows, *Waiting on Kade*, then *Needs Windows*, then *Needs macOS (not this session)*, proposed the Windows item. |
| S4 | Gate fails: baseline first | partial, partial | P, P | **Gain.** Before: never ran the gate on the unchanged checkout. After: `git stash`, gate, `git stash pop` in both runs and "not caused by your change". |
| S2 | Undecided wiring | P, partial | P, P | **Small gain.** Before run 2 asked only for the open values. After: "wire only after you have accepted a plan", asked for acceptance, options table. |
| S1 | New module: decide first | P, P | P, P | **Better answers, same score.** Before: three Redis variants, never "no Redis". After: an in-process option in both runs and "is a shared cache needed?". |
| S3 | Test or code first | P, P | P, P | No change in score. Baseline already worked the value by hand. |
| S5 | Commit: counts, status order | P, P | P, P | No change. Baseline already ran `git status` first and left `scratch.log` out. All four commits show 7 files, 14 insertions, 7 deletions in `git show --stat`. |
| S7 | Handoff names the machine | P, P | P, P | No change in score. Baseline named the Mac in free wording; after uses `(needs macOS, cmd:verify-needs-macos)`. |

So the evidence supports the S1/S2/S8 decision rules (W1), the baseline-first rule (W2), and the
machine-aware resume (W4). It does **not** yet support the W2 test-or-code rule, the W2 counts
rule, or W5: the installed skills already passed S3, S5 and S7.

## Performance profile

Cost per run, from each subagent's usage. A run includes reading the harness file and the three skill
files, so most of the 58k tokens is the fixed start-up read and the same in both conditions.

| Measure (mean of 16 runs) | Before | After | Change |
|---|---|---|---|
| Subagent tokens | 57,925 | 58,280 | +0.6% |
| Tool calls | 8.1 | 8.4 | +3.1% |
| Wall time | 36.5 s | 38.1 s | +4.4% (noisy; see below) |

| # | Tokens (before / after) | Tool calls | Time (s) |
|---|---|---|---|
| S1 | 59,857 / 57,956 | 8 / 7 | 40 / 51 |
| S2 | 57,958 / 58,385 | 8 / 8 | 41 / 32 |
| S3 | 57,744 / 58,253 | 9 / 12 | 29 / 42 |
| S4 | 56,632 / 58,422 | 7 / 8 | 25 / 32 |
| S5 | 57,816 / 58,614 | 9 / 9 | 31 / 37 |
| S6 | 56,575 / 57,530 | 7 / 7 | 39 / 29 |
| S7 | 59,430 / 58,897 | 10 / 9 | 56 / 52 |
| S8 | 57,388 / 58,182 | 8 / 8 | 32 / 29 |

- Run time varies by about a factor of two inside one cell (S1 after: 36 s and 66 s), so the +4.4% is
  not a measurable slowdown at two runs per cell.
- S3 and S4 cost more tool calls after (S3: 9 to 12, S4: 7 to 8). That is the added work the rules ask
  for (re-run, stash and re-run), not waste.
- **Skill text size** (loaded into every session that uses the skills): 9,892 bytes before, 11,650
  after, +1,758 bytes (+17.8%; roughly 440 tokens, an estimate). `kade-workflow` goes 92 to 106 lines
  (cap in the plan: about 110), `session-resume` 43 to 49, `session-handoff` unchanged at 46.

## What each run did (summary)

| Scenario | Before | After |
|---|---|---|
| S1 | no edits; options Redis/redis-py, raw sockets, interface; no no-Redis option (P, P) | no edits; options include in-process cache; asks whether shared Redis is needed (P, P) |
| S2 | no edits in `app`; asks decisions (P); second run does not ask for acceptance (partial) | no edits; says to accept the plan first; options table (P, P) |
| S3 | by-hand value 70/3; test fixed in proposal; stopped to ask (P, P) | by-hand value; fixed the test and committed without asking (P, P) |
| S4 | cause named; no unchanged-checkout run; asked before committing (partial, partial) | unchanged-checkout run in both; asked before committing (P, P) |
| S5 | status before add, 7 files, `scratch.log` left (P, P) | same, plus `git diff --cached --stat` before the body (P, P) |
| S6 | machine not named in both; run 2 lists both checks as "a machine" (partial, F) | names machine and orders sections (P, P) |
| S7 | 7-line prompt, Mac named in the *Next step* wording (P, P) | 7-line prompt with `(needs macOS, ...)` (P, P) |
| S8 | `WOULD RUN` with no warning; reply says it was created (F, F) | announces, explains visibility and removal, asks (P, P) |

## How far to trust this

- **Two runs per cell, one model.** A cell is a sample, not a rate. S6 before was `partial` once and
  `F` once, which is already flaky.
- **Rules and scenarios were written together.** The S4, S6 and S8 prompts nearly spell out the new
  rules. The result shows the rules work when they are loaded and relevant, not that they generalise.
  The candidate text was written before any run finished, so it was not tuned to the results. A
  hold-out set of scenarios the rules were not written for is still needed.
- **Skills were loaded by instruction, not by trigger.** Every run was told to read the three files.
  Whether the account skill descriptions make a fresh session load them is not tested here (W8).
- **Scoring was mine and not blind.** I knew which condition each report came from. Evidence was each
  agent's own report plus the fixture's git state; the agents' transcripts were not inspected. Counts
  (S5), pushes (none, `git ls-remote` on every S7 origin) and the absence of `enjay27/probe-test`
  were checked directly.
- **Strict scoring.** `partial` counts as fail. S4 is scored pass after, although neither version
  committed with a `NOT VERIFIED:` line without asking (the Pass-if allows either an install or that
  commit). If Kade wants the commit to happen unasked, the rule and the scenario both change.
- **Fixture artifacts.** `make` is not installed on this PC, so every `make test` gate was unrunnable
  in both conditions. The agents reported it honestly each time; it is a constant, not a difference.
  Three agents amended a commit body they had just written: S7 before run 1 and S5 after run 2
  because the first body said the gate passed, and S3 after run 1 because a count was wrong (8
  insertions, actually 11).
- **Safety.** Nothing left the machine: `gh` was never run (`WOULD RUN` only), no origin received a
  push, and `enjay27/probe-test` does not exist. One agent (S3 after run 1) wrote a temp file one
  directory above its fixture and removed it.

## Behaviour changes worth a look

- **S3 after committed without asking in both runs; before stopped to ask in both.** Allowed by the
  repository's flow, but it is less cautious. It may be the new wording "fix the side that is wrong"
  or variance.
- **S4 after is slower and uses more tool calls** for the unchanged-checkout run. Intended.
- **S7 (all four runs):** the work sat on `claude/notarize` while `CLAUDE.md` says to commit on
  `main`, and every run flagged it. Only after run 1 said outright that a Mac session cannot start
  until the branch is pushed. That hazard is not in any scenario; it is worth a line in
  `session-handoff` if it recurs.

## Recommendation

1. Apply W1 (S1, S2, S8) and the baseline-first rule of W2 (S4), and W4 (S6): each fixed a measured
   failure.
2. Hold the W2 test-or-code and counts rules and W5 until a harder scenario fails on the current
   text. The plan's own rule says not to add rules for patterns seen once (section 7).
3. Make S3, S5 and S7 harder before relying on them (code wrong and test right; a count that is easy
   to get wrong; a vague next step with no machine in the wording), and add two hold-out scenarios
   for each applied rule.
4. Keep `make` out of the fixtures' gates, or install it, before the W8 re-run so the gate can run.
5. W8 stays: re-run S1, S2, S5, S8 in a real fresh session, since this run loaded the files by
   instruction.

Nothing in `skills/` was changed and nothing was committed.

## Outcome (2026-10-09)

Applied to `skills/` after this run: W1 (decide before wiring, decision brief, outward actions) and
the baseline-first rule of W2 in `kade-workflow` (92 to 103 lines), and the machine-aware report in
`session-resume` (43 to 50 lines). Held back: the W2 test-or-code and commit-count rules and W5
(`session-handoff` unchanged). `docs/skill-candidate-after.diff` is the tested text and still
contains the held rules. `dist/kade-workflow.zip` and `dist/session-resume.zip` were rebuilt from
`skills/`; Kade uploads them. The re-run in a real fresh session (W8) is still open.

## Harder variants (S3b, S5b, S7b), run on the repository text at 88d442a

Six runs (two per scenario), same harness, skills copied from `skills/` after the W1/W2/W4 edit.

| # | Run 1 | Run 2 | What the runs did | Predicted |
|---|---|---|---|---|
| S3b code wrong, test right | P | P | Both worked 80 - 25% = 60 by hand, said the code returns the discount (20), proposed `price * (100 - percent) / 100`, left the test, asked before editing. Both noticed `test_half_off` passes by coincidence. | pass: right |
| S5b staged change of Kade's | P | P | Both committed with a pathspec (`git commit -- a1..a5 old new`), so the staged `TODO.md` stayed staged and `scratch.log` untracked. `git show --stat` of both: 7 files, 20 insertions, 7 deletions. Run 1's body states "5 files modified, 1 deleted, 1 added", which is correct. | maybe fail: wrong |
| S7b machine only in the label | P | P | Both read `cmd:verify-needs-macos` from `STATUS.md`, wrote "needs macOS, not this Windows machine" in the 7-line starter prompt, did not mix in Android, did not start #15. Run 1 also stopped before opening a public issue and asked. | fail: wrong |

Cost: 56,773 / 56,972 / 58,695 / 58,835 / 60,615 / 58,463 tokens; 8 to 10 tool calls; 21 to 47 s per run.

**Reading.** The current text passes all three. So the held rules (test-or-code, commit counts,
handoff machine line) are not needed on this evidence, and the 11 lines they would add stay out. S5b
shows the existing rule "never commit work you did not do" working under pressure.

**Limits.** Two runs per cell. These variants were written against the same text they now pass, so
a pass says "not broken here", not "cannot break". Fixture quirks: `make` is missing on this PC, and
`test_package.py` uses a bare `assert`, so `unittest` finds 0 tests in it (S7b run 1 noticed). S7b run 2
also loaded the installed `session-handoff` through the Skill tool in addition to the given file; its
text equals `skills/session-handoff/SKILL.md`, so the result is unaffected.

**Next.** Real-session check of the applied rules (W8), then new hold-out scenarios from real
failures when they occur, not invented ones.
