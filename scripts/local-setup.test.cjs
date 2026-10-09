// Run: node --test scripts/local-setup.test.cjs
// The local setup scripts (setup/local-setup.sh for macOS and Linux, setup/local-setup.ps1 for
// Windows) against a local origin with two releases. The PowerShell cases run where `pwsh` is on
// the PATH (GitHub's Ubuntu runners have it); Windows PowerShell 5.1 itself is not covered.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const hasPwsh = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "exit 0"]).status === 0;

const SHELLS = [
  { name: "local-setup.sh", run: (args) => ["bash", [path.join(ROOT, "setup", "local-setup.sh"), ...args]], skip: false },
  {
    name: "local-setup.ps1",
    run: (args) => ["pwsh", ["-NoLogo", "-NoProfile", "-File", path.join(ROOT, "setup", "local-setup.ps1"), ...args]],
    skip: !hasPwsh && "pwsh is not installed",
  },
];

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// An origin with releases v2026.01.01 and v2026.01.02 laid out like claude-global.
function origin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lsetup-"));
  const work = path.join(root, "work");
  fs.mkdirSync(path.join(work, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(work, "docs"));
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.email", "t@t");
  git(work, "config", "user.name", "t");
  for (const f of ["deploy-exclude", "settings.global.json", ".gitattributes", ".gitignore", "hooks/global-sync.cjs"]) {
    fs.copyFileSync(path.join(ROOT, f), path.join(work, f));
  }
  fs.writeFileSync(path.join(work, "docs", "plan.md"), "dev only\n");
  for (const tag of ["v2026.01.01", "v2026.01.02"]) {
    fs.writeFileSync(path.join(work, "CLAUDE.md"), `Global rules: ${tag}\n\nA rule.\n`);
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", tag);
    git(work, "tag", tag);
  }
  const bare = path.join(root, "origin.git");
  git(root, "clone", "-q", "--bare", work, bare);
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), "secret");
  return { remote: bare, home, c: path.join(home, ".claude") };
}

function setup(shell, w) {
  const [cmd, args] = shell.run([]);
  return spawnSync(cmd, args, {
    env: { ...process.env, HOME: w.home, CLAUDE_GLOBAL_REMOTE: w.remote },
    encoding: "utf8",
  });
}

const read = (w, f) => fs.readFileSync(path.join(w.c, f), "utf8");

for (const shell of SHELLS) {
  test(`${shell.name}: a fresh ~/.claude ends on the latest release, with personal text kept as a rule`, { skip: shell.skip }, () => {
    const w = origin();
    fs.writeFileSync(path.join(w.c, "CLAUDE.md"), "my own lines\n");
    const r = setup(shell, w);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(read(w, "CLAUDE.md").split("\n")[0], "Global rules: v2026.01.02");
    assert.strictEqual(read(w, "rules/local.md"), "my own lines\n");
    assert.match(read(w, "settings.json"), /global-sync\.cjs/);
    assert.strictEqual(git(w.c, "status", "--short"), "");
    assert.strictEqual(read(w, ".credentials.json"), "secret");
    assert.ok(!fs.existsSync(path.join(w.c, "docs")));
  });

  test(`${shell.name}: refuses a ~/.claude that is already a git repository`, { skip: shell.skip }, () => {
    const w = origin();
    git(w.c, "init", "-q");
    const r = setup(shell, w);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /already a git repository/);
    assert.ok(!fs.existsSync(path.join(w.c, "CLAUDE.md")));
  });

  test(`${shell.name}: refuses when settings.json has hooks of its own in ~/.claude/hooks/`, { skip: shell.skip }, () => {
    const w = origin();
    const mine = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "bash ~/.claude/hooks/mine.sh" }] }] } });
    fs.writeFileSync(path.join(w.c, "settings.json"), mine);
    const r = setup(shell, w);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /would replace/);
    assert.ok(!fs.existsSync(path.join(w.c, ".git")));
    assert.strictEqual(read(w, "settings.json"), mine);
  });

  test(`${shell.name}: a file in the way stops it and leaves ~/.claude as it was`, { skip: shell.skip }, () => {
    const w = origin();
    fs.writeFileSync(path.join(w.c, "CLAUDE.md"), "my own lines\n");
    fs.mkdirSync(path.join(w.c, "hooks"));
    fs.writeFileSync(path.join(w.c, "hooks", "global-sync.cjs"), "mine\n");
    const r = setup(shell, w);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /nothing was changed/i);
    assert.ok(!fs.existsSync(path.join(w.c, ".git")));
    assert.strictEqual(read(w, "hooks/global-sync.cjs"), "mine\n");
    assert.strictEqual(read(w, "CLAUDE.md"), "my own lines\n");
    assert.ok(!fs.existsSync(path.join(w.c, "rules", "local.md")));
  });
}
