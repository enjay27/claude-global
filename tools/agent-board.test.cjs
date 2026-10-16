// Run: node --test tools/agent-board.test.cjs
// agent-board against temporary repositories and a temporary AgentNotes folder. Git runs with an
// empty global config, so the developer's own settings (hooks, autocrlf) do not reach the cases.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const board = require("./agent-board.cjs");

const TOOL = path.join(__dirname, "agent-board.cjs");
const AUTHOR = "Claude <noreply@anthropic.com>";

function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-board-")));
  const gitconfig = path.join(base, "gitconfig");
  fs.writeFileSync(gitconfig, "");
  const env = {
    ...process.env,
    AGENT_NOTES_DIR: path.join(base, "AgentNotes"),
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Dev",
    GIT_AUTHOR_EMAIL: "dev@example.invalid",
    GIT_COMMITTER_NAME: "Dev",
    GIT_COMMITTER_EMAIL: "dev@example.invalid",
  };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const repo = (name) => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "README.txt"), "hello\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "first");
    return dir;
  };
  const run = (cwd, ...args) => {
    let out = "";
    let err = "";
    const code = board.main(args, { cwd, env, out: (s) => (out += s), err: (s) => (err += s) });
    return { code, out, err };
  };
  const ok = (cwd, ...args) => {
    const r = run(cwd, ...args);
    assert.strictEqual(r.code, 0, `agent-board ${args.join(" ")} failed: ${r.err}`);
    return r;
  };
  const notes = (name) => path.join(env.AGENT_NOTES_DIR, name);
  const task = (name, id) => {
    const dir = path.join(notes(name), "tasks");
    const file = fs.readdirSync(dir).find((f) => f.startsWith(`${id}-`) || f === `${id}.md`);
    return { file: path.join(dir, file), ...board.parseTask(fs.readFileSync(path.join(dir, file), "utf8")) };
  };
  return { base, env, git, repo, run, ok, notes, task };
}

const today = board.today();

function fillPr(file, subject = "Login no longer times out after 30 s: the pool keeps 4 connections") {
  fs.writeFileSync(
    file,
    `${subject}\n\n## What changed and why\n\nThe pool size went from 1 to 4.\n\n` +
      `## Verified\n\nnode --test, 3 pass.\n\n## NOT VERIFIED\n\nnone\n\n## Wrong turns\n\nnone\n`,
  );
}

// A repository with a task on its branch, one commit ahead, ready for finish.
function started(s, opts = {}) {
  const repo = s.repo(opts.name || "app");
  s.ok(repo, "init");
  if (opts.gate !== null) s.ok(repo, "config", `gate=${opts.gate || "node -e \"require('fs').accessSync('feature.txt')\""}`);
  s.ok(repo, "new", "Add the feature");
  s.ok(repo, "start", "T-1");
  fs.writeFileSync(path.join(repo, "feature.txt"), "feature\n");
  s.git(repo, "add", "-A");
  s.git(repo, "commit", "-q", "-m", "Add the feature");
  const t = s.task(path.basename(repo), "T-0001");
  fillPr(path.join(s.notes(path.basename(repo)), "prs", path.basename(t.file)));
  return repo;
}

test("a task file keeps its fields and body; a title may hold a colon", () => {
  const fields = { id: "T-0003", title: "Fix: the login", status: "Now", priority: "P1", created: "2026-10-16" };
  const text = board.formatTask(fields, "\n## Goal\n\nx\n");
  const back = board.parseTask(text);
  assert.strictEqual(back.fields.title, "Fix: the login");
  assert.strictEqual(back.fields.status, "Now");
  assert.strictEqual(back.fields.waiting, "");
  assert.strictEqual(back.body, "\n## Goal\n\nx\n");
  assert.deepStrictEqual(Object.keys(back.fields), board.FIELDS);
});

test("init makes AgentNotes a local git repository and the project folder, named after the checkout", () => {
  const s = sandbox();
  const repo = s.repo("shop");
  s.ok(repo, "init");
  const project = JSON.parse(fs.readFileSync(path.join(s.notes("shop"), "project.json"), "utf8"));
  assert.strictEqual(project.repo, repo);
  assert.strictEqual(project.mainBranch, "main");
  assert.strictEqual(project.merge, "no-ff");
  assert.ok(fs.existsSync(path.join(s.notes("shop"), "STATUS.md")));
  const root = s.env.AGENT_NOTES_DIR;
  assert.ok(s.git(root, "log", "--oneline").length > 0, "AgentNotes has a commit");
  assert.strictEqual(s.git(root, "remote"), "", "AgentNotes has no remote");
  assert.strictEqual(fs.readFileSync(path.join(root, ".gitattributes"), "utf8"), "* text=auto eol=lf\n");
  // A second init changes nothing and succeeds.
  const head = s.git(root, "rev-parse", "HEAD");
  s.ok(repo, "init");
  assert.strictEqual(s.git(root, "rev-parse", "HEAD"), head);
});

test("a worktree belongs to the project of its main checkout", () => {
  const s = sandbox();
  const repo = s.repo("shop");
  s.ok(repo, "init");
  const wt = path.join(s.base, "shop-T-0009");
  s.git(repo, "worktree", "add", "-q", "-b", "side", wt);
  assert.strictEqual(s.ok(wt, "new", "From a worktree").code, 0);
  assert.ok(fs.readdirSync(path.join(s.notes("shop"), "tasks")).length === 1);
  assert.ok(!fs.existsSync(s.notes("shop-T-0009")));
});

test("two repositories with one folder name: the second is refused until it names its project", () => {
  const s = sandbox();
  const one = s.repo("a/app");
  const two = s.repo("b/app");
  s.ok(one, "init");
  const r = s.run(two, "init");
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /belongs to/);
  assert.match(r.err, /agent-project/);
  fs.writeFileSync(path.join(two, ".git", "agent-project"), "app-b\n");
  s.ok(two, "init");
  assert.ok(fs.existsSync(path.join(s.notes("app-b"), "project.json")));
});

test("AgentNotes inside the repository, or with a remote, is refused", () => {
  const s = sandbox();
  const repo = s.repo("app");
  const inside = s.run(repo, "init");
  assert.strictEqual(inside.code, 0);
  const env = { ...s.env, AGENT_NOTES_DIR: path.join(repo, "notes") };
  let err = "";
  assert.strictEqual(board.main(["init"], { cwd: repo, env, out: () => {}, err: (x) => (err += x) }), 1);
  assert.match(err, /outside the repository/);
  s.git(s.env.AGENT_NOTES_DIR, "remote", "add", "origin", "https://example.invalid/notes.git");
  const r = s.run(repo, "new", "x");
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /remote/);
});

test("new numbers tasks, fills the defaults and commits AgentNotes", () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  const first = s.ok(repo, "new", "Fix the login timeout", "--priority", "p1");
  assert.match(first.out, /T-0001/);
  s.ok(repo, "new", "Second task");
  const t1 = s.task("app", "T-0001");
  assert.strictEqual(path.basename(t1.file), "T-0001-fix-the-login-timeout.md");
  assert.strictEqual(t1.fields.status, "Backlog");
  assert.strictEqual(t1.fields.priority, "P1");
  assert.strictEqual(t1.fields.created, today);
  assert.strictEqual(path.basename(s.task("app", "T-0002").file), "T-0002-second-task.md");
  assert.strictEqual(s.git(s.env.AGENT_NOTES_DIR, "status", "--porcelain"), "", "everything committed");
  assert.match(fs.readFileSync(path.join(s.notes("app"), "STATUS.md"), "utf8"), /T-0002/);
});

test("a title with no ASCII letters still gets a file name", () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  s.ok(repo, "new", "로그인 시간 초과");
  assert.strictEqual(path.basename(s.task("app", "T-0001").file), "T-0001-task.md");
});

test("set validates every value before writing any", () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  s.ok(repo, "new", "A task");
  const before = fs.readFileSync(s.task("app", "T-0001").file, "utf8");
  for (const bad of [["priority=P1", "status=Doing"], ["id=T-9"], ["colour=red"], ["target=next week"], ["waiting=bob"]]) {
    const r = s.run(repo, "set", "T-1", ...bad);
    assert.strictEqual(r.code, 1, bad.join(" "));
    assert.strictEqual(fs.readFileSync(s.task("app", "T-0001").file, "utf8"), before);
  }
  s.ok(repo, "set", "1", "status=next", "verification=not verified", "waiting=Developer", "target=2026-11-01");
  const t = s.task("app", "T-0001");
  assert.strictEqual(t.fields.status, "Next");
  assert.strictEqual(t.fields.verification, "NOT VERIFIED");
  assert.strictEqual(t.fields.waiting, "developer");
  assert.strictEqual(t.fields.target, "2026-11-01");
});

test("STATUS.md follows the Project snapshot's sections and order", () => {
  const task = (id, f) => ({ file: `tasks/${id}-x.md`, fields: { id, title: `Task ${id}`, status: "Backlog", ...f } });
  const tasks = [
    task("T-0001", { status: "Now", priority: "P1", phase: "Beta" }),
    task("T-0002", { status: "In review" }),
    task("T-0003", { status: "Backlog", waiting: "developer" }),
    task("T-0004", { status: "Done", verification: "NOT VERIFIED", phase: "Beta", target: "2026-11-01" }),
    task("T-0005", { status: "Next", priority: "P2" }),
    task("T-0006", { status: "Backlog", priority: "P3" }),
  ];
  const md = board.renderStatus(tasks, "app", { phases: ["Beta", "Release"] }, new Date(2026, 9, 16, 9, 5));
  const headings = md.split("\n").filter((l) => l.startsWith("## ") || l.startsWith("### "));
  assert.deepStrictEqual(headings, [
    "## Now (1)",
    "## In review (1)",
    "## Waiting on the developer (1)",
    "## NOT VERIFIED (1)",
    "## Next (1)",
    "## Roadmap",
    "### Beta: 1/2 done, target 2026-11-01",
    "## Backlog (2)",
  ]);
  assert.match(md, /^# Status: app$/m);
  assert.match(md, /Generated 2026-10-16 09:05/);
  assert.match(md, /^Board: Backlog 2 · Next 1 · Now 1 · In review 1 · Done 1$/m);
  assert.match(md, /^- \[T-0001\]\(tasks\/T-0001-x\.md\) Task T-0001 · P1 · Beta$/m);
  assert.match(md, /Open items with no phase: 4/);
  assert.ok(md.indexOf("T-0003") < md.indexOf("T-0006"), "backlog sorted: no priority last");
});

test("board prints each column", () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  s.ok(repo, "new", "One", "--priority", "P2");
  s.ok(repo, "new", "Two", "--status", "Next");
  const out = s.ok(repo, "board").out;
  assert.match(out, /Backlog \(1\)\n {2}T-0001 P2 One/);
  assert.match(out, /Next \(1\)\n {2}T-0002 Two/);
  assert.match(out, /Now \(0\)/);
});

test("start refuses a dirty tree, then branches from main and writes the PR doc", () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  s.ok(repo, "new", "Add the feature");
  fs.writeFileSync(path.join(repo, "README.txt"), "changed\n");
  const dirty = s.run(repo, "start", "T-1");
  assert.strictEqual(dirty.code, 1);
  assert.match(dirty.err, /uncommitted/);
  s.git(repo, "checkout", "--", "README.txt");
  s.ok(repo, "start", "T-1");
  assert.strictEqual(s.git(repo, "branch", "--show-current"), "agent/T-0001-add-the-feature");
  const t = s.task("app", "T-0001");
  assert.strictEqual(t.fields.status, "Now");
  assert.strictEqual(t.fields.branch, "agent/T-0001-add-the-feature");
  assert.strictEqual(t.fields.start, today);
  const pr = fs.readFileSync(path.join(s.notes("app"), "prs", "T-0001-add-the-feature.md"), "utf8");
  for (const h of ["## What changed and why", "## Verified", "## NOT VERIFIED", "## Wrong turns"]) assert.ok(pr.includes(h), h);
  // Starting again switches back to the same branch.
  s.git(repo, "switch", "-q", "main");
  s.ok(repo, "start", "T-1");
  assert.strictEqual(s.git(repo, "branch", "--show-current"), "agent/T-0001-add-the-feature");
});

test("start pulls main with --ff-only when it tracks a remote", () => {
  const s = sandbox();
  const origin = path.join(s.base, "origin.git");
  const seed = s.repo("seed");
  s.git(s.base, "clone", "-q", "--bare", seed, origin);
  s.git(s.base, "clone", "-q", origin, "app");
  const repo = path.join(s.base, "app");
  s.git(seed, "remote", "add", "origin", origin);
  fs.writeFileSync(path.join(seed, "new.txt"), "upstream\n");
  s.git(seed, "add", "-A");
  s.git(seed, "commit", "-q", "-m", "upstream change");
  s.git(seed, "push", "-q", "origin", "main");
  s.ok(repo, "init");
  s.ok(repo, "new", "Task");
  s.ok(repo, "start", "T-1");
  assert.ok(fs.existsSync(path.join(repo, "new.txt")), "the branch starts from the pulled main");
  assert.strictEqual(s.git(repo, "rev-parse", "main"), s.git(seed, "rev-parse", "HEAD"));
});

test("start --worktree leaves the main checkout alone", () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  s.ok(repo, "new", "Parallel");
  const r = s.ok(repo, "start", "T-1", "--worktree");
  const wt = path.join(s.base, "app-T-0001");
  assert.ok(r.out.includes(wt));
  assert.strictEqual(s.git(repo, "branch", "--show-current"), "main");
  assert.strictEqual(s.git(wt, "branch", "--show-current"), "agent/T-0001-parallel");
});

test("finish needs a filled PR doc, a commit on the branch and a clean tree", () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  s.ok(repo, "new", "Add the feature");
  s.ok(repo, "start", "T-1");
  const prFile = path.join(s.notes("app"), "prs", "T-0001-add-the-feature.md");
  let r = s.run(repo, "finish", "T-1");
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /TODO/);
  fillPr(prFile);
  r = s.run(repo, "finish", "T-1");
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /no commits/);
  fs.writeFileSync(path.join(repo, "feature.txt"), "feature\n");
  s.git(repo, "add", "-A");
  s.git(repo, "commit", "-q", "-m", "Add the feature");
  fs.writeFileSync(prFile, fs.readFileSync(prFile, "utf8").replace("## Verified\n\nnode --test, 3 pass.\n", "## Verified\n\n"));
  r = s.run(repo, "finish", "T-1");
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /Verified/);
  fillPr(prFile);
  s.ok(repo, "config", "subjectPattern=^PROJ-\\d+ ");
  r = s.run(repo, "finish", "T-1");
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /subjectPattern/);
  fillPr(prFile, "PROJ-12 Login no longer times out");
  r = s.ok(repo, "finish", "T-1");
  assert.match(r.out, /Ask the developer/);
  assert.strictEqual(s.task("app", "T-0001").fields.status, "In review");
});

test("merge waits for In review and a gate", () => {
  const s = sandbox();
  const repo = started(s, { gate: null });
  let r = s.run(repo, "merge", "T-1", "--author", AUTHOR);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /In review/);
  s.ok(repo, "finish", "T-1");
  r = s.run(repo, "merge", "T-1", "--author", AUTHOR);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /gate/);
  assert.strictEqual(s.git(repo, "rev-list", "--count", "main"), "1");
});

test("merge: the gate runs on the merged tree and the PR doc is the message", () => {
  const s = sandbox();
  const repo = started(s);
  s.ok(repo, "finish", "T-1");
  const r = s.ok(repo, "merge", "T-1", "--author", AUTHOR);
  assert.match(r.out, /merged T-0001/);
  assert.strictEqual(s.git(repo, "branch", "--show-current"), "main");
  const msg = s.git(repo, "log", "-1", "--format=%B");
  assert.match(msg, /^Login no longer times out/);
  assert.match(msg, /^## What changed and why$/m, "markdown headings survive the commit");
  assert.match(msg, /^Task: T-0001$/m);
  assert.strictEqual(s.git(repo, "log", "-1", "--format=%an <%ae>"), AUTHOR);
  assert.strictEqual(s.git(repo, "log", "-1", "--format=%P").split(" ").length, 2, "a merge commit");
  assert.strictEqual(s.git(repo, "branch", "--list", "agent/*"), "");
  const t = s.task("app", "T-0001");
  assert.strictEqual(t.fields.status, "Done");
  assert.strictEqual(t.fields.closed, today);
});

test("merge with a failing gate leaves main as it was", () => {
  const s = sandbox();
  const repo = started(s, { gate: 'node -e "process.exit(3)"' });
  s.ok(repo, "finish", "T-1");
  const head = s.git(repo, "rev-parse", "main");
  const r = s.run(repo, "merge", "T-1", "--author", AUTHOR);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /gate failed/);
  assert.strictEqual(s.git(repo, "rev-parse", "HEAD"), head);
  assert.strictEqual(s.git(repo, "status", "--porcelain"), "");
  assert.strictEqual(s.task("app", "T-0001").fields.status, "In review");
});

test("merge --no-gate records the reason as NOT VERIFIED", () => {
  const s = sandbox();
  const repo = started(s, { gate: null });
  s.ok(repo, "finish", "T-1");
  s.ok(repo, "merge", "T-1", "--author", AUTHOR, "--no-gate", "no JDK on this PC");
  assert.match(s.git(repo, "log", "-1", "--format=%B"), /^NOT VERIFIED: gate: no JDK on this PC$/m);
});

test("merge with a conflict merges nothing", () => {
  const s = sandbox();
  const repo = started(s);
  s.ok(repo, "finish", "T-1");
  s.git(repo, "switch", "-q", "main");
  fs.writeFileSync(path.join(repo, "feature.txt"), "other\n");
  s.git(repo, "add", "-A");
  s.git(repo, "commit", "-q", "-m", "conflicting change");
  const head = s.git(repo, "rev-parse", "HEAD");
  const r = s.run(repo, "merge", "T-1", "--author", AUTHOR);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /conflict/);
  assert.strictEqual(s.git(repo, "rev-parse", "HEAD"), head);
  assert.strictEqual(s.git(repo, "status", "--porcelain"), "");
});

test("merge=squash makes one ordinary commit", () => {
  const s = sandbox();
  const repo = started(s);
  s.ok(repo, "config", "merge=squash");
  s.ok(repo, "finish", "T-1");
  s.ok(repo, "merge", "T-1", "--author", AUTHOR);
  assert.strictEqual(s.git(repo, "log", "-1", "--format=%P").split(" ").length, 1);
  assert.ok(fs.existsSync(path.join(repo, "feature.txt")));
  assert.strictEqual(s.git(repo, "branch", "--list", "agent/*"), "");
});

test("merge removes the task's worktree", () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  s.ok(repo, "config", "gate=node -e 0");
  s.ok(repo, "new", "Parallel");
  s.ok(repo, "start", "T-1", "--worktree");
  const wt = path.join(s.base, "app-T-0001");
  fs.writeFileSync(path.join(wt, "p.txt"), "p\n");
  s.git(wt, "add", "-A");
  s.git(wt, "commit", "-q", "-m", "p");
  fillPr(path.join(s.notes("app"), "prs", "T-0001-parallel.md"));
  s.ok(wt, "finish", "T-1");
  s.ok(wt, "merge", "T-1", "--author", AUTHOR);
  assert.ok(!fs.existsSync(wt));
  assert.ok(fs.existsSync(path.join(repo, "p.txt")));
});

test("config validates its keys", () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  for (const bad of ["merge=rebase", "mainBranch=nope", "subjectPattern=(", "colour=red"]) {
    assert.strictEqual(s.run(repo, "config", bad).code, 1, bad);
  }
  s.ok(repo, "config", "phases=Beta, Release", "gate=gradlew.bat test");
  const project = JSON.parse(fs.readFileSync(path.join(s.notes("app"), "project.json"), "utf8"));
  assert.deepStrictEqual(project.phases, ["Beta", "Release"]);
  assert.strictEqual(project.gate, "gradlew.bat test");
  s.ok(repo, "new", "x");
  assert.strictEqual(s.run(repo, "set", "T-1", "phase=Gamma").code, 1);
  s.ok(repo, "set", "T-1", "phase=beta");
  assert.strictEqual(s.task("app", "T-0001").fields.phase, "Beta");
});

test("two agents creating tasks at once get different numbers", async () => {
  const s = sandbox();
  const repo = s.repo("app");
  s.ok(repo, "init");
  const one = (title) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [TOOL, "new", title], { cwd: repo, env: s.env });
      p.on("close", resolve);
    });
  const codes = await Promise.all([one("first"), one("second"), one("third")]);
  assert.deepStrictEqual(codes, [0, 0, 0]);
  const ids = fs.readdirSync(path.join(s.notes("app"), "tasks")).map((f) => f.slice(0, 6)).sort();
  assert.deepStrictEqual(ids, ["T-0001", "T-0002", "T-0003"]);
  assert.strictEqual(s.git(s.env.AGENT_NOTES_DIR, "status", "--porcelain"), "");
});

test("outside a repository it says so", () => {
  const s = sandbox();
  const r = s.run(s.base, "board");
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /not inside a git repository/);
});
