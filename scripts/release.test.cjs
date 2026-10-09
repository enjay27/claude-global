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
  return execFileSync(process.execPath, [path.join(__dirname, "release.cjs"), ...args], {
    cwd,
    env: { ...process.env, RELEASE_DATE: "2026-10-12", RELEASE_SKIP_TESTS: "1" },
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

test("prepare refuses a dirty working tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-"));
  git(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "x"), "x");
  assert.throws(() => release(root, "prepare", "x"), /uncommitted changes/);
});
