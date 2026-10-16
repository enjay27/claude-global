// Run: node --test setup/install.test.cjs
// The installer against a temporary home folder (LOCAL_CONFIG_HOME) and temporary repositories.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const install = require("./install.cjs");

const ROOT = path.join(__dirname, "..");
const SKILLS = fs.readdirSync(path.join(ROOT, "skills"));

function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "local-config-")));
  const home = path.join(base, "home");
  fs.mkdirSync(home);
  const gitconfig = path.join(base, "gitconfig");
  fs.writeFileSync(gitconfig, "");
  const env = {
    ...process.env,
    LOCAL_CONFIG_HOME: home,
    AGENT_NOTES_DIR: path.join(home, "AgentNotes"),
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Dev",
    GIT_AUTHOR_EMAIL: "dev@example.invalid",
    GIT_COMMITTER_NAME: "Dev",
    GIT_COMMITTER_EMAIL: "dev@example.invalid",
  };
  const run = (...args) => {
    let out = "";
    let err = "";
    const code = install.main(args, { env, out: (s) => (out += s), err: (s) => (err += s) });
    return { code, out, err };
  };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const claude = (...p) => path.join(home, ".claude", ...p);
  return { base, home, env, run, git, claude };
}

const read = (f) => fs.readFileSync(f, "utf8");
const src = (...p) => read(path.join(ROOT, ...p));

// Every file under dir with its contents, for "nothing changed" checks.
function tree(dir) {
  const files = {};
  if (!fs.existsSync(dir)) return files;
  for (const rel of fs.readdirSync(dir, { recursive: true })) {
    const full = path.join(dir, rel);
    if (fs.statSync(full).isFile()) files[rel] = { text: read(full), mtime: fs.statSync(full).mtimeMs };
  }
  return files;
}

test("a fresh install writes the rules, skills, hooks, tool and settings into ~/.claude", () => {
  const s = sandbox();
  const r = s.run();
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(read(s.claude("AGENTS.md")), src("AGENTS.md"));
  assert.strictEqual(read(s.claude("CLAUDE.md")), "@AGENTS.md\n");
  assert.strictEqual(read(s.claude("hooks", "context-guard.cjs")), src("hooks", "context-guard.cjs"));
  assert.strictEqual(read(s.claude("tools", "agent-board.cjs")), src("tools", "agent-board.cjs"));
  for (const skill of SKILLS) assert.strictEqual(read(s.claude("skills", skill, "SKILL.md")), src("skills", skill, "SKILL.md"));
  assert.ok(!fs.existsSync(s.claude("hooks", "context-guard.test.cjs")), "tests are not installed");
  const settings = JSON.parse(read(s.claude("settings.json")));
  assert.match(JSON.stringify(settings.hooks.UserPromptSubmit), /context-guard\.cjs/);
  const manifest = JSON.parse(read(s.claude(".local-config.json")));
  assert.strictEqual(manifest.version, src("AGENTS.md").split("\n")[0]);
  assert.ok(manifest.files["AGENTS.md"]);
  assert.ok(!fs.existsSync(path.join(s.home, ".pi")), "no Pi folder is created");
  assert.match(r.out, /Pi: not installed/);
});

test("Pi gets a full copy of the rules and the skills when ~/.pi/agent exists", () => {
  const s = sandbox();
  fs.mkdirSync(path.join(s.home, ".pi", "agent"), { recursive: true });
  assert.strictEqual(s.run().code, 0);
  const pi = path.join(s.home, ".pi", "agent");
  assert.strictEqual(read(path.join(pi, "AGENTS.md")), src("AGENTS.md"));
  for (const skill of SKILLS) assert.ok(fs.existsSync(path.join(pi, "skills", skill, "SKILL.md")));
  assert.ok(!fs.existsSync(path.join(pi, "settings.json")), "Pi's settings are not touched");
});

test("a second run changes nothing", () => {
  const s = sandbox();
  fs.mkdirSync(path.join(s.home, ".pi", "agent"), { recursive: true });
  s.run();
  const before = tree(s.home);
  const r = s.run();
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /Claude Code: up to date/);
  assert.deepStrictEqual(tree(s.home), before);
});

test("a file of the developer's in the way stops the install before anything is written", () => {
  const s = sandbox();
  fs.mkdirSync(s.claude());
  fs.writeFileSync(s.claude("CLAUDE.md"), "my own rules\n");
  const r = s.run();
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /CLAUDE\.md/);
  assert.match(r.err, /nothing was changed/);
  assert.deepStrictEqual(Object.keys(tree(s.claude())), ["CLAUDE.md"]);
});

test("an installed file edited since is not overwritten", () => {
  const s = sandbox();
  s.run();
  fs.appendFileSync(s.claude("skills", SKILLS[0], "SKILL.md"), "my note\n");
  const r = s.run();
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /changed since it was installed/);
});

test("a file dropped from the source is removed when unchanged, kept when edited", () => {
  const s = sandbox();
  s.run();
  const manifestFile = s.claude(".local-config.json");
  const manifest = JSON.parse(read(manifestFile));
  const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
  fs.mkdirSync(s.claude("skills", "old-skill"), { recursive: true });
  fs.writeFileSync(s.claude("skills", "old-skill", "SKILL.md"), "old\n");
  fs.writeFileSync(s.claude("hooks", "old.cjs"), "edited\n");
  manifest.files["skills/old-skill/SKILL.md"] = hash("old\n");
  manifest.files["hooks/old.cjs"] = hash("original\n");
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const r = s.run();
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(!fs.existsSync(s.claude("skills", "old-skill")), "removed with its empty folder");
  assert.ok(fs.existsSync(s.claude("hooks", "old.cjs")), "an edited file is kept");
  assert.match(r.out, /kept hooks\/old\.cjs/);
});

test("settings.json keeps the developer's entries and replaces only ~/.claude/hooks/ ones", () => {
  const s = sandbox();
  fs.mkdirSync(s.claude());
  const own = { hooks: [{ type: "command", command: "my-linter" }] };
  const stale = { hooks: [{ type: "command", command: 'node "$HOME/.claude/hooks/global-sync.cjs"' }] };
  fs.writeFileSync(s.claude("settings.json"), JSON.stringify({ model: "local", hooks: { SessionStart: [own, stale] } }));
  assert.strictEqual(s.run().code, 0);
  const settings = JSON.parse(read(s.claude("settings.json")));
  assert.strictEqual(settings.model, "local");
  const commands = JSON.stringify(settings.hooks);
  assert.match(commands, /my-linter/);
  assert.doesNotMatch(commands, /global-sync/);
  assert.match(commands, /context-guard/);
});

test("an unreadable settings.json, or ~/.claude as a git checkout, is refused", () => {
  const s = sandbox();
  fs.mkdirSync(s.claude());
  fs.writeFileSync(s.claude("settings.json"), "{ not json");
  let r = s.run();
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /settings\.json/);
  fs.rmSync(s.claude("settings.json"));
  fs.mkdirSync(s.claude(".git"));
  r = s.run();
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /git checkout/);
});

test("--dry-run lists the changes and writes nothing", () => {
  const s = sandbox();
  const r = s.run("--dry-run");
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /would write AGENTS\.md/);
  assert.ok(!fs.existsSync(s.claude()));
});

function companyRepo(s) {
  const repo = path.join(s.base, "work", "shop");
  fs.mkdirSync(repo, { recursive: true });
  s.git(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "old.txt"), "a\r\nb\r\n");
  s.git(repo, "add", "-A");
  s.git(repo, "commit", "-q", "-m", "a CRLF file from before");
  return repo;
}

test("--repo writes .git/info/attributes once, keeps other lines, and sets up the project", () => {
  const s = sandbox();
  const repo = companyRepo(s);
  const attributes = path.join(repo, ".git", "info", "attributes");
  fs.mkdirSync(path.dirname(attributes), { recursive: true });
  fs.writeFileSync(attributes, "*.png binary\n");
  const r = s.run("--repo", repo);
  assert.strictEqual(r.code, 0, r.err);
  const text = read(attributes);
  assert.match(text, /^\*\.png binary$/m);
  assert.match(text, /^\* text=auto eol=lf$/m);
  assert.match(text, /^\*\.bat -text$/m);
  assert.match(r.out, /1 file is stored with CRLF/);
  assert.ok(fs.existsSync(path.join(s.home, "AgentNotes", "shop", "project.json")));
  assert.strictEqual(s.run("--repo", repo).code, 0);
  assert.strictEqual(read(attributes), text, "a second run changes nothing");
  assert.strictEqual(s.git(repo, "status", "--porcelain"), "", "nothing in the repository's tracked files");
});

test("with the attributes, text is committed with LF and .bat files exactly as they are", () => {
  const s = sandbox();
  const repo = companyRepo(s);
  assert.strictEqual(s.run("--repo", repo).code, 0);
  fs.writeFileSync(path.join(repo, "App.java"), "class App {\r\n}\r\n");
  fs.writeFileSync(path.join(repo, "run.bat"), "@echo off\r\nexit 0\r\n");
  fs.writeFileSync(path.join(repo, "logo.bin"), Buffer.from([0, 13, 10, 255]));
  s.git(repo, "add", "-A");
  const eol = s.git(repo, "ls-files", "--eol", "App.java", "run.bat", "logo.bin");
  assert.match(eol, /^i\/lf\s.*App\.java$/m);
  assert.match(eol, /^i\/crlf\s.*run\.bat$/m);
  assert.match(eol, /^i\/-text\s.*logo\.bin$/m);
});

test("--repo outside a git repository is refused", () => {
  const s = sandbox();
  const r = s.run("--repo", s.base);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /not a git repository/);
});
