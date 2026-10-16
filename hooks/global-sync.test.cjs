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
const SHIM = "@AGENTS.md\n";
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

test("mergeSettings sets the fragment's env keys and keeps the user's own", () => {
  const before = { env: { MINE: "1", DO_NOT_TRACK: "0" } };
  const fragment = { ...FRAGMENT, env: { DO_NOT_TRACK: "1", GRAFT_TRAIL_AUTOPUSH: "0" } };
  const once = gs.mergeSettings(structuredClone(before), fragment);
  assert.deepStrictEqual(once.env, { MINE: "1", DO_NOT_TRACK: "1", GRAFT_TRAIL_AUTOPUSH: "0" });
  assert.deepStrictEqual(gs.mergeSettings(structuredClone(once), fragment), once);
});

test("mergeSettings adds no env key when the fragment has none", () => {
  assert.strictEqual(gs.mergeSettings({}, FRAGMENT).env, undefined);
  assert.deepStrictEqual(gs.mergeSettings({ env: { MINE: "1" } }, FRAGMENT).env, { MINE: "1" });
});

test("the deployed fragment turns off Graft's telemetry and trail push", () => {
  const fragment = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "settings.global.json"), "utf8"));
  assert.strictEqual(fragment.env?.DO_NOT_TRACK, "1");
  assert.strictEqual(fragment.env?.GRAFT_TRAIL_AUTOPUSH, "0");
});

// ---- against real git repositories ---------------------------------------------------------

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// An origin with releases (and noise tags), and a home whose ~/.claude is checked out at `at`.
// A release in `agents` is laid out as after the AGENTS.md move: the rules and their stamp in
// AGENTS.md, CLAUDE.md the one line @AGENTS.md. ~/.claude's sparse checkout is the list every
// machine set up before that move has, without /AGENTS.md.
// A release in `skills` also holds this repository's agents.json and one skill in agent-skills/
// (step 9), and `gemini` creates ~/.gemini/config, where Antigravity's skills copy goes.
function world({ releases = ["v2026.01.01", "v2026.01.02"], at = "v2026.01.01", agents = [], skills = [], gemini = false } = {}) {
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
    const rules = `Global rules: ${tag}\n\nRule of ${tag}.\n`;
    if (agents.includes(tag)) {
      fs.writeFileSync(path.join(work, "AGENTS.md"), rules);
      fs.writeFileSync(path.join(work, "CLAUDE.md"), SHIM);
    } else {
      fs.writeFileSync(path.join(work, "CLAUDE.md"), rules);
    }
    if (skills.includes(tag)) {
      fs.copyFileSync(path.join(__dirname, "..", "agents.json"), path.join(work, "agents.json"));
      fs.mkdirSync(path.join(work, "agent-skills", "alpha"), { recursive: true });
      fs.writeFileSync(path.join(work, "agent-skills", "alpha", "SKILL.md"), `Alpha of ${tag}.\n`);
    }
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
  if (gemini) fs.mkdirSync(path.join(home, ".gemini", "config"), { recursive: true });
  return { root, work, origin, home, c };
}

function run(w, args = []) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, HOME: w.home, CLAUDE_GLOBAL_DIR: w.c },
    encoding: "utf8",
  });
}

const stamp = (w, file = "CLAUDE.md") => gs.readStamp(fs.readFileSync(path.join(w.c, file), "utf8"));
const sparse = (w) => git(w.c, "sparse-checkout", "list").split("\n").filter(Boolean);

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

// ---- the AGENTS.md move (docs/agent-migration-plan.md, step 7) ----------------------------

test("a machine on a CLAUDE.md release moves to an AGENTS.md release in one session", () => {
  const w = world({ agents: ["v2026.01.02"] });
  const out = run(w);
  assert.strictEqual(stamp(w, "AGENTS.md"), "v2026.01.02");
  assert.strictEqual(fs.readFileSync(path.join(w.c, "CLAUDE.md"), "utf8").replace(/\r\n/g, "\n"), SHIM);
  assert.match(out, /Global rules updated v2026\.01\.01 -> v2026\.01\.02/);
  assert.match(out, /Rule of v2026\.01\.02\./, "prints the rules, not the one-line shim");
  assert.strictEqual(git(w.c, "status", "--short"), "");
  assert.strictEqual(run(w), "", "up to date from the next session");
});

test("a machine the previous hook moved to an AGENTS.md release without AGENTS.md recovers next session", () => {
  // The hook before this change checks the release out with the old sparse list: CLAUDE.md is the
  // shim and AGENTS.md is missing, so the session loads no rules. The next session must repair it.
  const w = world({ agents: ["v2026.01.02"], at: "v2026.01.02" });
  assert.ok(!fs.existsSync(path.join(w.c, "AGENTS.md")), "the state the previous hook leaves");
  const out = run(w);
  assert.strictEqual(stamp(w, "AGENTS.md"), "v2026.01.02");
  assert.match(out, /Global rules updated \(none\) -> v2026\.01\.02/);
  assert.match(out, /Rule of v2026\.01\.02\./);
  assert.strictEqual(run(w), "");
});

test("adds /AGENTS.md to the sparse checkout once, also when already up to date", () => {
  const w = world({ at: "v2026.01.02" });
  assert.strictEqual(run(w), "");
  assert.deepStrictEqual(sparse(w).filter((p) => p === "/AGENTS.md"), ["/AGENTS.md"]);
  run(w);
  assert.deepStrictEqual(sparse(w).filter((p) => p === "/AGENTS.md"), ["/AGENTS.md"]);
  assert.ok(sparse(w).includes("/CLAUDE.md"), "the other paths stay");
});

test("a checkout that is not sparse is left that way", () => {
  const w = world({ at: "v2026.01.02" });
  git(w.c, "sparse-checkout", "disable");
  assert.strictEqual(run(w), "");
  assert.notStrictEqual(git(w.c, "config", "--default", "false", "--get", "core.sparseCheckout").trim(), "true");
});

// ---- Antigravity's copies (docs/agent-migration-plan.md, step 9) ---------------------------

const geminiSkill = (w) => path.join(w.home, ".gemini", "config", "skills", "alpha", "SKILL.md");
// The test checkouts follow core.autocrlf (CRLF on Windows); ~/.claude has .gitattributes eol=lf.
const readLf = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

test("adds /agent-skills/ and /agents.json to the sparse checkout once", () => {
  const w = world({ at: "v2026.01.02" });
  run(w);
  run(w);
  for (const p of ["/agent-skills/", "/agents.json"]) {
    assert.deepStrictEqual(sparse(w).filter((s) => s === p), [p]);
  }
});

test("a machine the previous hook moved to the step 9 release gets the copies at its next session", () => {
  // The previous hook checks the release out with the old sparse list and never syncs the agents.
  const w = world({ skills: ["v2026.01.02"], at: "v2026.01.02", gemini: true });
  assert.ok(!fs.existsSync(path.join(w.c, "agents.json")), "the state the previous hook leaves");
  assert.strictEqual(run(w), "", "up to date, and the copies are made quietly");
  assert.strictEqual(readLf(geminiSkill(w)), "Alpha of v2026.01.02.\n");
  assert.strictEqual(
    fs.readFileSync(path.join(w.home, ".gemini", "AGENTS.md"), "utf8"),
    "@[Kade's global rules](~/.claude/AGENTS.md)\n"
  );
  assert.ok(!/agent/.test(git(w.c, "status", "--short")), "the new paths are tracked, not stray");
  assert.ok(git(w.c, "ls-files").includes("agent-skills/alpha/SKILL.md"));
});

test("moving to a newer release updates Antigravity's copies in the same session", () => {
  const w = world({ releases: ["v2026.01.01", "v2026.01.02", "v2026.01.03"], skills: ["v2026.01.02", "v2026.01.03"], at: "v2026.01.02", gemini: true });
  git(w.c, "sparse-checkout", "add", "/agent-skills/", "/agents.json");
  assert.match(run(w), /Global rules updated v2026\.01\.02 -> v2026\.01\.03/);
  assert.strictEqual(readLf(geminiSkill(w)), "Alpha of v2026.01.03.\n");
});

test("unreachable origin: Antigravity's copies are still kept", () => {
  const w = world({ skills: ["v2026.01.02"], at: "v2026.01.02", gemini: true });
  git(w.c, "remote", "set-url", "origin", path.join(w.root, "missing.git"));
  const out = run(w);
  assert.strictEqual(out.trim(), "Global rules: could not check for updates; using v2026.01.02.");
  assert.ok(fs.existsSync(geminiSkill(w)));
});

test("--install also makes Antigravity's copies", () => {
  const w = world({ skills: ["v2026.01.02"], gemini: true });
  run(w, ["--install"]);
  assert.ok(fs.existsSync(geminiSkill(w)));
});

test("the stamp in AGENTS.md wins over CLAUDE.md's", () => {
  const w = world(); // at v2026.01.01, origin has v2026.01.02
  fs.writeFileSync(path.join(w.c, "AGENTS.md"), "Global rules: v2026.02.01\n"); // ahead of origin
  assert.strictEqual(run(w), "", "CLAUDE.md's older stamp alone would move it to v2026.01.02");
  assert.strictEqual(stamp(w), "v2026.01.01");
});
