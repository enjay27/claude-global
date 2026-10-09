// Run: node --test hooks/global-sync.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const gs = require("./global-sync.cjs");

const SCRIPT = path.join(__dirname, "global-sync.cjs");
const SYNC = 'node "$HOME/.claude/hooks/global-sync.cjs"';
const EXCLUDE = "*\n!.gitignore\n!CLAUDE.md\n!hooks/\n!hooks/**\n!settings.global.json\n";
const FRAGMENT = {
  hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: SYNC, timeout: 30 }] }] },
};

// ---- pure parts ----------------------------------------------------------------------------

test("compareVersions orders release tags numerically", () => {
  assert.ok(gs.compareVersions("v2026.10.9", "v2026.10.10") < 0);
  assert.ok(gs.compareVersions("v2026.10.12", "v2026.10.12.2") < 0);
  assert.ok(gs.compareVersions("v2027.01.01", "v2026.12.31") > 0);
  assert.strictEqual(gs.compareVersions("v2026.10.09", "v2026.10.9"), 0);
});

test("latestRelease ignores non-release tags", () => {
  const tags = ["v2026.10.09", "v0.0.0-probe", "foo", "v2026.10.12", "v2026.10.10", "vX"];
  assert.strictEqual(gs.latestRelease(tags), "v2026.10.12");
  assert.strictEqual(gs.latestRelease(["v0-probe", "bar"]), null);
});

test("readStamp takes the version from line 1 of CLAUDE.md", () => {
  assert.strictEqual(gs.readStamp("Global rules: v2026.10.12\n\nrules"), "v2026.10.12");
  assert.strictEqual(gs.readStamp("Global rules: v0-probe\n"), null);
  assert.strictEqual(gs.readStamp("# no stamp\n"), null);
});

function ours(settings, event = "SessionStart") {
  return (settings.hooks?.[event] || []).filter((g) => g.hooks.some((h) => h.command.includes("/.claude/hooks/")));
}

test("mergeSettings keeps foreign keys and hooks and is idempotent", () => {
  const before = {
    permissions: { allow: ["Bash(ls:*)"] },
    hooks: {
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo mine" }] }],
      Stop: [{ hooks: [{ type: "command", command: "bash ~/.claude/stop-hook-git-check.sh" }] }],
    },
  };
  const once = gs.mergeSettings(structuredClone(before), FRAGMENT);
  assert.deepStrictEqual(once.permissions, before.permissions);
  assert.deepStrictEqual(once.hooks.Stop, before.hooks.Stop);
  assert.ok(once.hooks.SessionStart.some((g) => g.hooks[0].command === "echo mine"));
  assert.strictEqual(ours(once).length, 1);
  assert.deepStrictEqual(gs.mergeSettings(structuredClone(once), FRAGMENT), once);
});

test("mergeSettings replaces the step 1 probe and drops our entries from events no longer listed", () => {
  const before = {
    hooks: {
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: 'node "$HOME/.claude/hooks/probe.cjs"' }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "$HOME/.claude/hooks/old.cjs"' }] }],
    },
  };
  const out = gs.mergeSettings(before, FRAGMENT);
  assert.deepStrictEqual(ours(out).map((g) => g.hooks[0].command), [SYNC]);
  assert.strictEqual(out.hooks.UserPromptSubmit, undefined);
});

// ---- against real git repositories ---------------------------------------------------------

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// An origin with releases (and noise tags), and a home whose ~/.claude is checked out at `at`.
function world({ releases = ["v2026.01.01", "v2026.01.02"], at = "v2026.01.01" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsync-"));
  const work = path.join(root, "work");
  const origin = path.join(root, "origin.git");
  fs.mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.email", "t@t");
  git(work, "config", "user.name", "t");
  fs.mkdirSync(path.join(work, "hooks"));
  fs.writeFileSync(path.join(work, "deploy-exclude"), EXCLUDE);
  fs.writeFileSync(path.join(work, "settings.global.json"), JSON.stringify(FRAGMENT));
  fs.mkdirSync(path.join(work, "docs"));
  fs.writeFileSync(path.join(work, "docs", "plan.md"), "dev only\n");
  for (const tag of releases) {
    fs.writeFileSync(path.join(work, "CLAUDE.md"), `Global rules: ${tag}\n\nRule of ${tag}.\n`);
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", tag);
    git(work, "tag", tag);
  }
  git(work, "tag", "v9.9.9-probe");
  git(root, "clone", "-q", "--bare", work, origin);

  const home = path.join(root, "home");
  const c = path.join(home, ".claude");
  fs.mkdirSync(path.join(c, "projects"), { recursive: true });
  fs.writeFileSync(path.join(c, ".credentials.json"), "secret");
  git(c, "init", "-q");
  git(c, "remote", "add", "origin", origin);
  git(c, "sparse-checkout", "set", "--no-cone", "/CLAUDE.md", "/hooks/", "/settings.global.json", "/.gitignore");
  if (at) {
    git(c, "fetch", "-q", "--depth", "1", "origin", "tag", at);
    git(c, "checkout", "-q", "--detach", at);
  }
  return { root, work, origin, home, c };
}

function run(w, args = []) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, HOME: w.home, CLAUDE_GLOBAL_DIR: w.c },
    encoding: "utf8",
  });
}

const stamp = (w) => gs.readStamp(fs.readFileSync(path.join(w.c, "CLAUDE.md"), "utf8"));

test("up to date: prints nothing and changes nothing", () => {
  const w = world({ at: "v2026.01.02" });
  const head = git(w.c, "rev-parse", "HEAD");
  assert.strictEqual(run(w), "");
  assert.strictEqual(git(w.c, "rev-parse", "HEAD"), head);
});

test("newer release: checks it out, prints the new rules, rewrites exclude and settings", () => {
  const w = world();
  const out = run(w);
  assert.strictEqual(stamp(w), "v2026.01.02");
  assert.match(out, /Global rules updated v2026\.01\.01 -> v2026\.01\.02/);
  assert.match(out, /Rule of v2026\.01\.02\./);
  assert.strictEqual(fs.readFileSync(path.join(w.c, ".git", "info", "exclude"), "utf8"), EXCLUDE);
  const s = JSON.parse(fs.readFileSync(path.join(w.c, "settings.json"), "utf8"));
  assert.strictEqual(ours(s).length, 1);
  assert.strictEqual(git(w.c, "status", "--short"), "");
  assert.ok(!fs.existsSync(path.join(w.c, "docs")), "development-only paths stay out of ~/.claude");
});

test("never moves backwards, and ignores non-release tags", () => {
  const w = world({ releases: ["v2026.01.01"], at: "v2026.01.01" });
  fs.writeFileSync(path.join(w.c, "CLAUDE.md"), "Global rules: v2026.02.01\n"); // ahead of origin
  assert.strictEqual(run(w), "");
  assert.strictEqual(stamp(w), "v2026.02.01");
});

test("a probe or unstamped checkout counts as older and is updated", () => {
  const w = world({ at: "v2026.01.01" });
  fs.writeFileSync(path.join(w.c, "CLAUDE.md"), "Global rules: v0-probe\n");
  const out = run(w);
  assert.strictEqual(stamp(w), "v2026.01.02");
  assert.match(out, /Global rules updated \(none\) -> v2026\.01\.02/);
});

test("unreachable origin: one line, exit 0, nothing changed", () => {
  const w = world();
  git(w.c, "remote", "set-url", "origin", path.join(w.root, "missing.git"));
  const out = run(w);
  assert.strictEqual(out.trim(), "Global rules: could not check for updates; using v2026.01.01.");
  assert.strictEqual(stamp(w), "v2026.01.01");
});

test("--install moves to the latest release and registers once, quietly for the session", () => {
  const w = world();
  run(w, ["--install"]);
  run(w, ["--install"]);
  assert.strictEqual(stamp(w), "v2026.01.02");
  const s = JSON.parse(fs.readFileSync(path.join(w.c, "settings.json"), "utf8"));
  assert.strictEqual(ours(s).length, 1);
  assert.strictEqual(fs.readFileSync(path.join(w.c, ".credentials.json"), "utf8"), "secret");
});

test("--install leaves an unreadable settings.json untouched", () => {
  const w = world({ at: "v2026.01.02" });
  fs.writeFileSync(path.join(w.c, "settings.json"), "{ not json");
  const out = run(w, ["--install"]);
  assert.strictEqual(fs.readFileSync(path.join(w.c, "settings.json"), "utf8"), "{ not json");
  assert.match(out, /not valid JSON/);
});
