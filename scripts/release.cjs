#!/usr/bin/env node
// release: cuts a release of the global rules (docs/global-rules-plan.md, section 6). A pushed tag
// reaches every session at its next start, so this is the only way to make one. `main` takes
// changes only through pull requests, so a release has two phases:
//
//   node scripts/release.cjs prepare "<what changed>"
//       From origin/main: picks the next tag (vYYYY.MM.DD, or .2, .3 on the same day), writes it
//       into line 1 of CLAUDE.md, runs the tests, commits on release/<tag> and pushes it.
//       Open and merge the pull request it prints.
//   node scripts/release.cjs tag
//       After the merge: checks that origin/main carries a stamp newer than every release, runs the
//       tests on that commit, tags it and pushes the tag.
//
// Run from the development clone, never from ~/.claude. prepare runs the tests before it creates
// anything, and on any failure returns to the branch it started from and deletes its release
// branch. Tests for this file set RELEASE_DATE, RELEASE_SKIP_TESTS and RELEASE_FAIL_TESTS.
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { compareVersions, latestRelease, readStamp } = require("../hooks/global-sync.cjs");

function nextTag(date, tags) {
  const base = "v" + date.replace(/-/g, ".");
  const latest = latestRelease(tags);
  if (latest && compareVersions(base, latest.split(".").slice(0, 3).join(".")) < 0) {
    throw new Error(`${base} is older than the latest release ${latest}; check the clock`);
  }
  if (!tags.includes(base)) return base;
  let n = 2;
  while (tags.includes(`${base}.${n}`)) n++;
  return `${base}.${n}`;
}

function setStamp(text, tag) {
  const line = `Global rules: ${tag}`;
  return /^Global rules: /.test(text) ? text.replace(/^[^\n]*/, line) : `${line}\n\n${text}`;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function today() {
  return process.env.RELEASE_DATE || new Date().toISOString().slice(0, 10);
}

function runTests() {
  if (process.env.RELEASE_FAIL_TESTS) throw new Error("tests failed (RELEASE_FAIL_TESTS)");
  if (process.env.RELEASE_SKIP_TESTS) return;
  try {
    execFileSync(process.execPath, ["--test"], { stdio: "inherit" });
  } catch {
    throw new Error("tests failed; nothing was released");
  }
}

function requireClean() {
  if (git("status", "--porcelain")) throw new Error("uncommitted changes; commit or stash them first");
}

function fetchMain() {
  git("fetch", "-q", "--tags", "origin", "main");
  return git("rev-parse", "FETCH_HEAD");
}

function startingPoint() {
  try {
    return git("symbolic-ref", "--short", "-q", "HEAD");
  } catch {
    return git("rev-parse", "HEAD");
  }
}

function prepare(summary) {
  if (!summary) throw new Error('usage: release.cjs prepare "<what changed>"');
  requireClean();
  const start = startingPoint();
  const main = fetchMain();
  const tag = nextTag(today(), git("tag", "-l", "v*").split("\n").filter(Boolean));
  const branch = `release/${tag}`;
  try {
    git("checkout", "-q", "--detach", main);
    if (!fs.existsSync("CLAUDE.md")) throw new Error("no CLAUDE.md on main; draft it first (plan step 3)");
    runTests();
    git("checkout", "-q", "-b", branch);
    fs.writeFileSync("CLAUDE.md", setStamp(fs.readFileSync("CLAUDE.md", "utf8"), tag));
    git("commit", "-q", "-am", `Release ${tag}: ${summary}`);
    git("push", "-q", "-u", "origin", branch);
  } catch (e) {
    git("checkout", "-q", "-f", start);
    try {
      git("branch", "-D", branch);
    } catch {}
    throw e;
  }
  const url = git("remote", "get-url", "origin").replace(/\.git$/, "");
  console.log(`Pushed ${branch}. Open and merge the pull request, then run: node scripts/release.cjs tag`);
  if (url.startsWith("https://github.com/")) console.log(`${url}/compare/${branch}?expand=1`);
}

function tag() {
  requireClean();
  const main = fetchMain();
  const stamp = readStamp(git("show", `${main}:CLAUDE.md`));
  if (!stamp) throw new Error("line 1 of CLAUDE.md on origin/main has no release stamp");
  const tags = git("tag", "-l", "v*").split("\n").filter(Boolean);
  const latest = latestRelease(tags);
  if (tags.includes(stamp) || (latest && compareVersions(stamp, latest) <= 0)) {
    throw new Error(`${stamp} is already released (latest: ${latest}); run prepare first`);
  }
  git("checkout", "-q", "--detach", main);
  runTests();
  git("tag", "-a", stamp, "-m", `Global rules ${stamp}`, main);
  git("push", "-q", "origin", stamp);
  console.log(`Released ${stamp}. Every session moves to it at its next start.`);
}

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    process.chdir(git("rev-parse", "--show-toplevel"));
    if (cmd === "prepare") prepare(rest.join(" "));
    else if (cmd === "tag") tag();
    else throw new Error('usage: release.cjs prepare "<what changed>" | tag');
  } catch (e) {
    console.error(`release: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { nextTag, setStamp };
