// Run: node --test hooks/probe.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const p = require("./probe.cjs");

const SCRIPT = path.join(__dirname, "probe.cjs");
const OURS = 'node "$HOME/.claude/hooks/probe.cjs"';

function ours(settings, event = "SessionStart") {
  return (settings.hooks?.[event] || []).filter((g) => g.hooks.some((h) => h.command.includes("/.claude/hooks/")));
}

test("merge into empty settings adds one SessionStart entry", () => {
  const out = p.mergeSettings({}, p.FRAGMENT);
  assert.strictEqual(ours(out).length, 1);
  assert.strictEqual(ours(out)[0].hooks[0].command, OURS);
});

test("merge keeps foreign keys and foreign hooks", () => {
  const before = {
    permissions: { allow: ["Bash(ls:*)"] },
    model: "x",
    hooks: {
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo mine" }] }],
      Stop: [{ hooks: [{ type: "command", command: "bash ~/.claude/stop-hook-git-check.sh" }] }],
    },
  };
  const out = p.mergeSettings(structuredClone(before), p.FRAGMENT);
  assert.deepStrictEqual(out.permissions, before.permissions);
  assert.strictEqual(out.model, "x");
  assert.deepStrictEqual(out.hooks.Stop, before.hooks.Stop);
  assert.ok(out.hooks.SessionStart.some((g) => g.hooks[0].command === "echo mine"));
  assert.strictEqual(ours(out).length, 1);
});

test("merge is idempotent", () => {
  const once = p.mergeSettings({}, p.FRAGMENT);
  const twice = p.mergeSettings(structuredClone(once), p.FRAGMENT);
  assert.deepStrictEqual(twice, once);
});

test("merge replaces an older entry of ours instead of adding a second", () => {
  const old = { hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: OURS, timeout: 99 }] }] } };
  const out = p.mergeSettings(old, p.FRAGMENT);
  assert.strictEqual(ours(out).length, 1);
  assert.notStrictEqual(ours(out)[0].hooks[0].timeout, 99);
});

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-"));
  fs.mkdirSync(path.join(dir, ".claude"));
  return dir;
}

function run(args, env, input = "") {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    input,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("--install creates settings.json when it is missing", () => {
  const h = home();
  run(["--install"], { HOME: h });
  const s = JSON.parse(fs.readFileSync(path.join(h, ".claude", "settings.json"), "utf8"));
  assert.strictEqual(ours(s).length, 1);
});

test("--install leaves an unreadable settings.json untouched and exits 0", () => {
  const h = home();
  const f = path.join(h, ".claude", "settings.json");
  fs.writeFileSync(f, "{ not json");
  const out = run(["--install"], { HOME: h });
  assert.strictEqual(fs.readFileSync(f, "utf8"), "{ not json");
  assert.match(out, /not valid JSON/);
});

test("hook run reports itself and an unreachable remote, and exits 0", () => {
  const out = run([], { PROBE_REMOTE: "https://127.0.0.1:9/none.git" }, JSON.stringify({ source: "startup" }));
  assert.match(out, /Probe: user-level SessionStart hook ran \(source=startup\)/);
  assert.match(out, /Probe: github\.com reachable: no/);
});
