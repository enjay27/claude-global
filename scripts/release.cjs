#!/usr/bin/env node
// release: the commands the Release workflow (.github/workflows/release.yml) runs on rc
// (docs/global-rules-plan.md, section 6). A pushed tag reaches every session at its next start,
// and that workflow is the only way to make one.
//
//   next     the tag for today (vYYYY.MM.DD, or .2, .3 on the same day); refuses a HEAD already
//            released as the parent of a stamped release commit
//   stamp T  writes "Global rules: T" into line 1 of AGENTS.md in the working tree
//   latest   the highest release tag, or nothing
//
// Tests for this file set RELEASE_DATE.
"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");
const { compareVersions, latestRelease } = require("../hooks/global-sync.cjs");

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

function releaseTags() {
  return git("tag", "-l", "v*").split("\n").filter(Boolean);
}

function next() {
  const head = git("rev-parse", "HEAD");
  const tags = releaseTags();
  for (const t of tags) {
    let parent;
    try {
      parent = git("rev-parse", "-q", "--verify", `${t}^{commit}^`);
    } catch {
      continue; // a root commit has no parent
    }
    if (parent === head && latestRelease([t]) === t) {
      throw new Error(`${head} is already released as ${t}`);
    }
  }
  return nextTag(today(), tags);
}

function stamp(tag) {
  if (!tag || latestRelease([tag]) !== tag) {
    throw new Error(`${tag || "(none)"} is not a release tag`);
  }
  fs.writeFileSync("AGENTS.md", setStamp(fs.readFileSync("AGENTS.md", "utf8"), tag));
}

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    process.chdir(git("rev-parse", "--show-toplevel"));
    if (cmd === "next") console.log(next());
    else if (cmd === "stamp") stamp(rest[0]);
    else if (cmd === "latest") console.log(latestRelease(releaseTags()) || "");
    else throw new Error("usage: release.cjs next | stamp <tag> | latest");
  } catch (e) {
    console.error(`release: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { nextTag, setStamp };
