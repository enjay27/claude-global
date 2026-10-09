#!/usr/bin/env node
// global-sync: keeps ~/.claude, a sparse checkout of github.com/enjay27/claude-global, on the latest
// release tag (docs/global-rules-plan.md, sections 5 and 6).
//
// Usage:
//   node global-sync.cjs             SessionStart hook (matcher "startup"). Moves to a newer release
//                                    if there is one and prints the new CLAUDE.md, because the old
//                                    one was already loaded; prints nothing when up to date.
//   node global-sync.cjs --install   Setup (cloud setup script, first local install): same update,
//                                    then rewrites .git/info/exclude and the hook entries in
//                                    ~/.claude/settings.json even when nothing changed.
//
// A release is a tag vYYYY.MM.DD or vYYYY.MM.DD.N; the version in use is line 1 of CLAUDE.md,
// "Global rules: <tag>" (scripts/release.cjs keeps them equal). It never moves backwards.
// It never fails a session: every path exits 0, with at most one line when something went wrong.
//
// Environment: CLAUDE_GLOBAL_DIR overrides the checkout (default: the folder above this file).
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const RELEASE = /^v\d+(\.\d+)*$/;
const STAMP = /^Global rules: (\S+)\s*$/;
// Hook entries whose command points into ~/.claude/hooks/ belong to claude-global. Merging removes
// all of them, from every event, then adds those in settings.global.json; nothing else is touched.
const OWNED = "/.claude/hooks/";

function compareVersions(a, b) {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function latestRelease(tags) {
  const releases = tags.filter((t) => RELEASE.test(t));
  return releases.length ? releases.sort(compareVersions).at(-1) : null;
}

function readStamp(text) {
  const m = STAMP.exec(text.split("\n")[0]);
  return m && RELEASE.test(m[1]) ? m[1] : null;
}

function isOwned(group) {
  return (group.hooks || []).some((h) => typeof h.command === "string" && h.command.includes(OWNED));
}

function mergeSettings(settings, fragment) {
  const hooks = settings.hooks || {};
  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event].filter((g) => !isOwned(g));
    if (!hooks[event].length) delete hooks[event];
  }
  for (const [event, groups] of Object.entries(fragment.hooks || {})) {
    hooks[event] = [...(hooks[event] || []), ...structuredClone(groups)];
  }
  settings.hooks = hooks;
  return settings;
}

function dir() {
  return process.env.CLAUDE_GLOBAL_DIR || path.join(__dirname, "..");
}

function git(...args) {
  return execFileSync("git", ["-C", dir(), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 6000,
  });
}

function currentVersion() {
  try {
    return readStamp(fs.readFileSync(path.join(dir(), "CLAUDE.md"), "utf8"));
  } catch {
    return null;
  }
}

// Returns { from, to } when it moved to a newer release, null when already up to date.
function update() {
  const from = currentVersion();
  const tags = git("ls-remote", "--tags", "--refs", "origin", "v*")
    .split("\n")
    .map((line) => line.split("refs/tags/")[1])
    .filter(Boolean);
  const to = latestRelease(tags);
  if (!to || (from && compareVersions(to, from) <= 0)) return null;
  git("fetch", "-q", "--depth", "1", "origin", "tag", to);
  git("checkout", "-q", "-f", "--detach", to);
  writeExclude();
  installSettings();
  return { from, to };
}

function writeExclude() {
  fs.writeFileSync(path.join(dir(), ".git", "info", "exclude"), git("show", "HEAD:deploy-exclude"));
}

// Returns a message when settings.json was left alone, null on success.
function installSettings() {
  const file = path.join(dir(), "settings.json");
  const fragment = JSON.parse(fs.readFileSync(path.join(dir(), "settings.global.json"), "utf8"));
  let settings = {};
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return `${file} is not valid JSON; left untouched.`;
    }
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(mergeSettings(settings, fragment), null, 2) + "\n");
  fs.renameSync(tmp, file);
  return null;
}

function hook() {
  let moved;
  try {
    moved = update();
  } catch {
    console.log(`Global rules: could not check for updates; using ${currentVersion() || "(none)"}.`);
    return;
  }
  if (!moved) return;
  const text = fs.readFileSync(path.join(dir(), "CLAUDE.md"), "utf8");
  console.log(
    `Global rules updated ${moved.from || "(none)"} -> ${moved.to} at session start. The text below ` +
      `replaces the ${moved.from || "earlier"} global rules loaded earlier in this session; changed ` +
      `files in ~/.claude/rules/ apply from the next session.\n\n${text}`
  );
}

function install() {
  let moved = null;
  try {
    moved = update();
  } catch (e) {
    console.log(`global-sync: could not check for updates (${e.message.split("\n")[0]}).`);
  }
  if (!moved) {
    writeExclude();
    const problem = installSettings();
    if (problem) {
      console.log(`global-sync: ${problem}`);
      return;
    }
  }
  console.log(`global-sync: ~/.claude at ${currentVersion() || "(none)"}; hooks registered.`);
}

if (require.main === module) {
  try {
    process.argv.includes("--install") ? install() : hook();
  } catch (e) {
    console.log(`global-sync: ${e.message.split("\n")[0]}`);
  }
  process.exit(0);
}

module.exports = { compareVersions, latestRelease, readStamp, mergeSettings };
