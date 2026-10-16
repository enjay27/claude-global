// Run: node --test hooks/agent-sync.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const as = require("./agent-sync.cjs");

const ROOT = path.join(__dirname, "..");
const LINK = "@[Kade's global rules](~/.claude/AGENTS.md)\n";
const MANIFEST = ".agent-sync.json";

// A home whose ~/.claude holds this repository's agents.json and the skills given, and the
// Antigravity folders listed in `gemini` (relative to ~/.gemini; "" is ~/.gemini itself).
function world({ skills = { alpha: "Alpha v1\n", beta: "Beta v1\n" }, gemini = ["", "config", "antigravity-cli"] } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "async-"));
  const c = path.join(home, ".claude");
  fs.mkdirSync(c);
  fs.copyFileSync(path.join(ROOT, "agents.json"), path.join(c, "agents.json"));
  setSkills(c, skills);
  for (const d of gemini) fs.mkdirSync(path.join(home, ".gemini", d), { recursive: true });
  return { home, c, g: path.join(home, ".gemini") };
}

function setSkills(c, skills) {
  const dir = path.join(c, "agent-skills");
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [name, body] of Object.entries(skills)) {
    fs.mkdirSync(path.join(dir, name, "references"), { recursive: true });
    fs.writeFileSync(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\n---\n${body}`);
    fs.writeFileSync(path.join(dir, name, "references", "notes.md"), `notes of ${name}\n`);
  }
}

const sync = (w) => as.sync(w.c, w.home);
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : null);
const COPIES = ["config/skills", "antigravity-cli/skills"];

test("no ~/.gemini: writes nothing and prints nothing", () => {
  const w = world({ gemini: [] });
  assert.deepStrictEqual(sync(w), []);
  assert.ok(!fs.existsSync(w.g));
});

test("with ~/.gemini: writes the rules link and both skills copies, quietly", () => {
  const w = world();
  assert.deepStrictEqual(sync(w), []);
  assert.strictEqual(read(w.g, "AGENTS.md"), LINK);
  for (const copy of COPIES) {
    assert.deepStrictEqual(entries(path.join(w.g, copy)), [MANIFEST, "alpha", "beta"], copy);
    assert.strictEqual(read(w.g, copy, "alpha", "SKILL.md"), read(w.c, "agent-skills", "alpha", "SKILL.md"));
    assert.strictEqual(read(w.g, copy, "beta", "references", "notes.md"), "notes of beta\n");
  }
  assert.deepStrictEqual(sync(w), [], "a second run changes nothing and prints nothing");
});

test("a skills folder whose parent is missing is skipped", () => {
  const w = world({ gemini: ["", "config"] }); // no antigravity-cli: that agent is not installed
  assert.deepStrictEqual(sync(w), []);
  assert.deepStrictEqual(entries(path.join(w.g, "config", "skills")), [MANIFEST, "alpha", "beta"]);
  assert.ok(!fs.existsSync(path.join(w.g, "antigravity-cli")));
});

test("a different ~/.gemini/AGENTS.md is left alone, with one line; the skills are still copied", () => {
  const w = world();
  fs.writeFileSync(path.join(w.g, "AGENTS.md"), "my own rules\n");
  const out = sync(w);
  assert.strictEqual(out.length, 1);
  assert.match(out[0], /AGENTS\.md/);
  assert.match(out[0], /left (it )?untouched/);
  assert.strictEqual(read(w.g, "AGENTS.md"), "my own rules\n");
  assert.deepStrictEqual(entries(path.join(w.g, "config", "skills")), [MANIFEST, "alpha", "beta"]);
});

test("the rules link written with CRLF line endings counts as ours", () => {
  const w = world();
  fs.writeFileSync(path.join(w.g, "AGENTS.md"), LINK.replace("\n", "\r\n"));
  assert.deepStrictEqual(sync(w), []);
});

test("a skill folder that is not ours is never touched, also one with our name", () => {
  const w = world();
  const s = path.join(w.g, "config", "skills");
  fs.mkdirSync(path.join(s, "mine"), { recursive: true });
  fs.writeFileSync(path.join(s, "mine", "SKILL.md"), "mine\n");
  fs.mkdirSync(path.join(s, "alpha"));
  fs.writeFileSync(path.join(s, "alpha", "SKILL.md"), "someone else's alpha\n");
  const out = sync(w);
  assert.strictEqual(out.length, 1, "one line for the clash");
  assert.match(out[0], /alpha/);
  assert.strictEqual(read(s, "mine", "SKILL.md"), "mine\n");
  assert.strictEqual(read(s, "alpha", "SKILL.md"), "someone else's alpha\n");
  assert.ok(fs.existsSync(path.join(s, "beta", "SKILL.md")), "the other skills are copied");
  setSkills(w.c, { beta: "Beta v1\n" }); // a release that drops alpha must not remove theirs
  sync(w);
  assert.strictEqual(read(s, "alpha", "SKILL.md"), "someone else's alpha\n");
  assert.strictEqual(read(s, "mine", "SKILL.md"), "mine\n");
});

test("after a release, a removed skill goes, a changed one is updated, a new one appears", () => {
  const w = world();
  sync(w);
  fs.writeFileSync(path.join(w.g, "config", "skills", "beta", "stale.md"), "left from an edit\n");
  setSkills(w.c, { beta: "Beta v2\n", gamma: "Gamma v1\n" });
  assert.deepStrictEqual(sync(w), []);
  for (const copy of COPIES) {
    const s = path.join(w.g, copy);
    assert.deepStrictEqual(entries(s), [MANIFEST, "beta", "gamma"], copy);
    assert.match(read(s, "beta", "SKILL.md"), /Beta v2/);
  }
  assert.deepStrictEqual(entries(path.join(w.g, "config", "skills", "beta")), ["SKILL.md", "references"]);
});

test("this repository's agents.json names Antigravity's link and both skills folders", () => {
  const cfg = JSON.parse(read(ROOT, "agents.json"));
  const ag = cfg.agents.find((a) => a.name === "Antigravity");
  assert.ok(ag, "an Antigravity entry");
  assert.deepStrictEqual(ag.rules, { path: "~/.gemini/AGENTS.md", text: LINK });
  assert.deepStrictEqual(ag.skills, ["~/.gemini/config/skills", "~/.gemini/antigravity-cli/skills"]);
});
