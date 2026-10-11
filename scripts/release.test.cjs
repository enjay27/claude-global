// Run: node --test scripts/release.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const r = require("./release.cjs");

test("nextTag is the date, or the date with a counter when it is taken", () => {
  assert.strictEqual(r.nextTag("2026-10-12", []), "v2026.10.12");
  assert.strictEqual(r.nextTag("2026-10-12", ["v2026.10.09"]), "v2026.10.12");
  assert.strictEqual(r.nextTag("2026-10-12", ["v2026.10.12"]), "v2026.10.12.2");
  assert.strictEqual(r.nextTag("2026-10-12", ["v2026.10.12", "v2026.10.12.2"]), "v2026.10.12.3");
});

test("nextTag refuses a date before the latest release", () => {
  assert.throws(() => r.nextTag("2026-10-01", ["v2026.10.12"]), /older than the latest release/);
});

test("setStamp writes line 1 and keeps the rest", () => {
  assert.strictEqual(r.setStamp("Global rules: v2026.10.09\n\nA rule.\n", "v2026.10.12"), "Global rules: v2026.10.12\n\nA rule.\n");
  assert.strictEqual(r.setStamp("A rule.\n", "v2026.10.12"), "Global rules: v2026.10.12\n\nA rule.\n");
});

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function release(cwd, ...args) {
  return releaseWith({ RELEASE_SKIP_TESTS: "1" }, cwd, ...args);
}

function releaseWith(env, cwd, ...args) {
  return execFileSync(process.execPath, [path.join(__dirname, "release.cjs"), ...args], {
    cwd,
    env: { ...process.env, RELEASE_DATE: "2026-10-12", ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("prepare pushes a stamped release branch; tag tags main once it is merged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-"));
  const origin = path.join(root, "origin.git");
  const dev = path.join(root, "dev");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, dev);
  git(dev, "symbolic-ref", "HEAD", "refs/heads/main");
  git(dev, "config", "user.email", "t@t");
  git(dev, "config", "user.name", "t");
  fs.writeFileSync(path.join(dev, "CLAUDE.md"), "Global rules: v2026.10.09\n\nA rule.\n");
  git(dev, "add", "-A");
  git(dev, "commit", "-q", "-m", "first");
  git(dev, "tag", "v2026.10.09");
  git(dev, "push", "-q", "origin", "main", "v2026.10.09");

  // tag before the release branch is merged: main's stamp is already released
  assert.throws(() => release(dev, "tag"), /already released/);

  release(dev, "prepare", "One rule reworded");
  assert.strictEqual(git(origin, "log", "-1", "--format=%s", "release/v2026.10.12"), "Release v2026.10.12: One rule reworded");
  assert.match(git(origin, "show", "release/v2026.10.12:CLAUDE.md"), /^Global rules: v2026\.10\.12\n\nA rule\.$/);

  git(origin, "update-ref", "refs/heads/main", "refs/heads/release/v2026.10.12"); // the PR merge
  release(dev, "tag");
  assert.strictEqual(git(origin, "rev-parse", "v2026.10.12^{commit}"), git(origin, "rev-parse", "main"));
  assert.throws(() => release(dev, "tag"), /already released/);
});

// A release starts from one origin, one clone on main, one release v2026.10.09.
function released() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-"));
  const origin = path.join(root, "origin.git");
  const dev = path.join(root, "dev");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, dev);
  git(dev, "symbolic-ref", "HEAD", "refs/heads/main");
  git(dev, "config", "user.email", "t@t");
  git(dev, "config", "user.name", "t");
  fs.writeFileSync(path.join(dev, "CLAUDE.md"), "Global rules: v2026.10.09\n\nA rule.\n");
  git(dev, "add", "-A");
  git(dev, "commit", "-q", "-m", "first");
  git(dev, "tag", "v2026.10.09");
  git(dev, "push", "-q", "origin", "main", "v2026.10.09");
  return { origin, dev };
}

test("prepare whose tests fail leaves no branch, no change, and the starting branch checked out", () => {
  const { origin, dev } = released();
  assert.throws(() => releaseWith({ RELEASE_FAIL_TESTS: "1" }, dev, "prepare", "x"), /tests failed/);
  assert.strictEqual(git(dev, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.strictEqual(git(dev, "status", "--porcelain"), "");
  assert.strictEqual(git(dev, "branch", "--list", "release/*"), "");
  assert.strictEqual(git(origin, "branch", "--list", "release/*"), "");
});

test("prepare refuses a dirty working tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-"));
  git(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "x"), "x");
  assert.throws(() => release(root, "prepare", "x"), /uncommitted changes/);
});

// The Release workflow (.github/workflows/release.yml) on rc: next, stamp, latest.
function rcCheckout() {
  const { dev } = released();
  fs.writeFileSync(path.join(dev, "CLAUDE.md"), "Global rules: v2026.10.09\n\nA rule.\nAnother rule.\n");
  git(dev, "commit", "-q", "-am", "second rule");
  return dev;
}

// What the workflow's tag job does with the API: a commit with the stamp whose parent is HEAD.
function tagStampedChild(dev, tag) {
  const head = git(dev, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(dev, "CLAUDE.md"), r.setStamp(fs.readFileSync(path.join(dev, "CLAUDE.md"), "utf8"), tag));
  git(dev, "add", "CLAUDE.md");
  const tree = git(dev, "write-tree");
  const commit = git(dev, "commit-tree", tree, "-p", head, "-m", `Release ${tag}`);
  git(dev, "tag", tag, commit);
  git(dev, "checkout", "-q", "--", ".");
  git(dev, "reset", "-q", "--hard", head);
}

test("next prints the tag for today, with a counter when today is taken", () => {
  const dev = rcCheckout();
  assert.strictEqual(release(dev, "next").trim(), "v2026.10.12");
  git(dev, "tag", "v2026.10.12", "HEAD~1");
  assert.strictEqual(release(dev, "next").trim(), "v2026.10.12.2");
});

test("next refuses a commit that is already released as a stamped child", () => {
  const dev = rcCheckout();
  tagStampedChild(dev, "v2026.10.12");
  assert.throws(() => release(dev, "next"), /already released as v2026\.10\.12/);
});

test("stamp writes the tag into line 1 of CLAUDE.md and nothing else", () => {
  const dev = rcCheckout();
  release(dev, "stamp", "v2026.10.12");
  assert.strictEqual(fs.readFileSync(path.join(dev, "CLAUDE.md"), "utf8"), "Global rules: v2026.10.12\n\nA rule.\nAnother rule.\n");
  assert.strictEqual(git(dev, "status", "--porcelain", "--untracked-files=all"), "M CLAUDE.md");
});

test("stamp refuses a name that is not a release tag", () => {
  const dev = rcCheckout();
  assert.throws(() => release(dev, "stamp", "2026.10.12"), /not a release tag/);
});

test("latest prints the highest release tag, ignoring other v tags", () => {
  const dev = rcCheckout();
  git(dev, "tag", "v0.0.0-probe");
  git(dev, "tag", "v2026.10.09.2");
  assert.strictEqual(release(dev, "latest").trim(), "v2026.10.09.2");
});
