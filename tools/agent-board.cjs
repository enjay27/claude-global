#!/usr/bin/env node
// agent-board: the Project and Board for repositories with no remote to manage (the local-config
// line of github.com/kade-agent/agent-config). It replaces issues, Project fields and STATUS.md:
//
//   AgentNotes\<project>\           AGENT_NOTES_DIR, default %USERPROFILE%\AgentNotes
//     project.json                  repo (its main checkout), mainBranch, merge, gate, subjectPattern, phases
//     STATUS.md                     written on every change; never edited by hand
//     tasks\T-0007-<slug>.md        one task: fields between --- lines, then free text
//     prs\T-0007-<slug>.md          the PR doc; it becomes the merge commit's message
//     notes\                        anything else for the project's tasks
//
// AgentNotes is a local git repository (never a remote): every change is one commit there.
// <project> is the folder name of the repository's main checkout (worktrees included), or the
// name in .git\agent-project. Nothing is ever written into the repository itself.
//
// Commands (run inside the repository):
//   init [--main <branch>]                 set up AgentNotes and the project
//   config [key=value ...]                 show or set project.json
//   new "<title>" [--priority P1] [--phase <name>] [--status <status>]
//   set <id> key=value ...                 change task fields
//   show <id> | board | snapshot
//   start <id> [--worktree] [--no-pull]    branch agent/<id>-<slug> from the updated main; status Now
//   finish <id>                            check the PR doc and the branch; status In review
//   merge <id> --author "Name <email>" [--no-gate "<reason>"] [--no-pull]
//                                          only after the developer said so: merge, gate, commit
//
// It never pushes and never adds a remote. Updating main is `git pull --ff-only` (or a
// fast-forward fetch when main is not checked out anywhere).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const FIELDS = ["id", "title", "status", "priority", "verification", "waiting", "phase", "start", "target", "branch", "created", "closed"];
const SETTABLE = FIELDS.filter((f) => f !== "id" && f !== "created");
const STATUSES = ["Backlog", "Next", "Now", "In review", "Done"];
const CHOICES = {
  status: STATUSES,
  priority: ["", "P1", "P2", "P3"],
  verification: ["", "Verified", "NOT VERIFIED"],
  waiting: ["", "developer"],
};
const DATES = ["start", "target", "closed"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MERGES = ["no-ff", "squash"];
const PR_SECTIONS = ["What changed and why", "Verified", "NOT VERIFIED", "Wrong turns"];
const NOTES_IDENTITY = ["-c", "user.name=agent-board", "-c", "user.email=agent-board@localhost"];
const TASK_BODY = "\n## Goal\n\n\n## Plan\n\n\n## Notes\n\n";
const PR_SKELETON =
  "TODO: subject - the finding or the point of the change, in one line\n\n" +
  "## What changed and why\n\nTODO: what changed, with numbers, and why\n\n" +
  "## Verified\n\nTODO: each gate run and its result\n\n" +
  '## NOT VERIFIED\n\nTODO: "NOT VERIFIED: <gate>: <reason>" for each gate that could not run, or "none"\n\n' +
  '## Wrong turns\n\nTODO: approaches tried and dropped, or "none"\n';

class BoardError extends Error {}
const fail = (msg) => {
  throw new BoardError(msg);
};

function today(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------------------- git

function git(ctx, cwd, args, opts = {}) {
  try {
    return execFileSync("git", args, { cwd, env: ctx.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
  } catch (e) {
    fail(`git ${args.join(" ")} failed in ${cwd}: ${String(e.stderr || e.message).trim()}`);
  }
}

// Output on success, null on failure.
function gitTry(ctx, cwd, args) {
  const r = spawnSync("git", args, { cwd, env: ctx.env, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function samePath(a, b) {
  const norm = (p) => {
    const r = path.resolve(p);
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function repoInfo(ctx) {
  const top = gitTry(ctx, ctx.cwd, ["rev-parse", "--show-toplevel"]);
  if (!top) fail("not inside a git repository: run agent-board in the repository the task belongs to");
  const common = path.resolve(ctx.cwd, git(ctx, ctx.cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const main = path.basename(common) === ".git" ? path.dirname(common) : common;
  let override = "";
  try {
    override = fs.readFileSync(path.join(common, "agent-project"), "utf8").trim();
  } catch {}
  const name = override || path.basename(main).replace(/\.git$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    fail(`"${name}" cannot be a project name: write one (letters, digits, . _ -) in ${path.join(common, "agent-project")}`);
  }
  return { top: path.resolve(top), common, main, name };
}

function clean(ctx, cwd) {
  return git(ctx, cwd, ["status", "--porcelain", "--untracked-files=no"]) === "";
}

// Checkout path -> branch, for every worktree of the repository.
function worktrees(ctx, cwd) {
  const out = git(ctx, cwd, ["worktree", "list", "--porcelain"]);
  const list = [];
  let cur = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) list.push((cur = { path: path.resolve(line.slice(9)), branch: "" }));
    else if (line.startsWith("branch refs/heads/") && cur) cur.branch = line.slice(18);
  }
  return list;
}

const branchExists = (ctx, cwd, b) => gitTry(ctx, cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]) !== null;

function detectMain(ctx, cwd) {
  const head = gitTry(ctx, cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head.replace(/^origin\//, "");
  for (const b of ["main", "master", "develop"]) if (branchExists(ctx, cwd, b)) return b;
  const cur = gitTry(ctx, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (cur) return cur;
  return fail("cannot tell the main branch: pass --main <branch>");
}

// Brings mainBranch up to date with its upstream, fast-forward only. Nothing to do without one.
function updateMain(ctx, p, noPull) {
  const main = p.config.mainBranch;
  const upstream = gitTry(ctx, p.repo.main, ["rev-parse", "--abbrev-ref", `${main}@{upstream}`]);
  if (!upstream || noPull) return;
  const holder = worktrees(ctx, p.repo.main).find((w) => w.branch === main);
  let r;
  if (holder) {
    if (!clean(ctx, holder.path)) fail(`${main} has uncommitted changes in ${holder.path}: the developer's; ask before going on`);
    r = spawnSync("git", ["pull", "--ff-only", "-q"], { cwd: holder.path, env: ctx.env, encoding: "utf8" });
  } else {
    const remote = gitTry(ctx, p.repo.main, ["config", `branch.${main}.remote`]);
    const merge = gitTry(ctx, p.repo.main, ["config", `branch.${main}.merge`]);
    r = spawnSync("git", ["fetch", "-q", remote, `${merge}:refs/heads/${main}`], { cwd: p.repo.main, env: ctx.env, encoding: "utf8" });
  }
  if (r.status !== 0) {
    fail(
      `could not bring ${main} up to date (git pull --ff-only): ${String(r.stderr).trim()}. ` +
        `Ask the developer, or run again with --no-pull to use the local ${main}`,
    );
  }
}

// ----------------------------------------------------------------------------------- AgentNotes

function notesRoot(env) {
  return path.resolve(env.AGENT_NOTES_DIR || path.join(os.homedir(), "AgentNotes"));
}

function ensureNotes(ctx, repo) {
  const root = notesRoot(ctx.env);
  if (inside(root, repo.main) || inside(repo.main, root)) {
    fail(`AgentNotes (${root}) must be outside the repository (${repo.main}); set AGENT_NOTES_DIR to another folder`);
  }
  fs.mkdirSync(root, { recursive: true });
  if (!fs.existsSync(path.join(root, ".git"))) {
    git(ctx, root, ["init", "-q"]);
  }
  if (!fs.existsSync(path.join(root, ".gitattributes"))) fs.writeFileSync(path.join(root, ".gitattributes"), "* text=auto eol=lf\n");
  checkNoRemote(ctx, root);
  return root;
}

function checkNoRemote(ctx, root) {
  if (git(ctx, root, ["remote"]) !== "") {
    fail(`AgentNotes (${root}) has a git remote; it holds company information and stays local. Remove the remote first`);
  }
}

function commitNotes(ctx, root, name, message) {
  git(ctx, root, ["add", "-A", "--", name, ".gitattributes"]);
  if (gitTry(ctx, root, ["diff", "--cached", "--quiet"]) !== null) return;
  git(ctx, root, [...NOTES_IDENTITY, "commit", "-q", "--no-verify", "-m", message]);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// One writer at a time across every agent using this AgentNotes.
function withLock(root, fn) {
  const lock = path.join(root, ".agent-board.lock");
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 60000) fs.rmSync(lock, { recursive: true, force: true });
      } catch {}
      if (Date.now() > deadline) fail(`AgentNotes is locked (${lock}); if no agent-board is running, delete that folder`);
      sleep(30 + Math.floor(Math.random() * 40));
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function loadProject(ctx) {
  const repo = repoInfo(ctx);
  const root = notesRoot(ctx.env);
  const dir = path.join(root, repo.name);
  const file = path.join(dir, "project.json");
  if (!fs.existsSync(file)) fail(`no project "${repo.name}" in ${root}: run "agent-board init" in this repository first`);
  checkNoRemote(ctx, root);
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  checkOwner(config, repo, dir);
  return { repo, root, dir, config };
}

function checkOwner(config, repo, dir) {
  if (!samePath(config.repo, repo.main)) {
    fail(`${dir} belongs to ${config.repo}, not ${repo.main}: write another project name in ${path.join(repo.common, "agent-project")}`);
  }
}

function writeProject(p) {
  fs.writeFileSync(path.join(p.dir, "project.json"), JSON.stringify(p.config, null, 2) + "\n");
}

// ---------------------------------------------------------------------------------------- tasks

function parseTask(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fields = Object.fromEntries(FIELDS.map((f) => [f, ""]));
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fields, body: m[2] };
}

function formatTask(fields, body) {
  const lines = FIELDS.map((f) => `${f}: ${fields[f] || ""}`.trimEnd());
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function listTasks(dir) {
  const tdir = path.join(dir, "tasks");
  if (!fs.existsSync(tdir)) return [];
  const tasks = [];
  for (const name of fs.readdirSync(tdir).sort()) {
    if (!/^T-\d{4,}(-.*)?\.md$/.test(name)) continue;
    const parsed = parseTask(fs.readFileSync(path.join(tdir, name), "utf8"));
    if (parsed) tasks.push({ file: `tasks/${name}`, path: path.join(tdir, name), ...parsed });
  }
  return tasks;
}

function normalizeId(raw) {
  const m = /^(?:T-?)?(\d+)$/i.exec(String(raw || "").trim());
  if (!m) fail(`"${raw}" is not a task id (T-0007, T-7 or 7)`);
  return `T-${m[1].replace(/^0+(?=\d)/, "").padStart(4, "0")}`;
}

function findTask(p, raw) {
  const id = normalizeId(raw);
  const task = listTasks(p.dir).find((t) => t.fields.id === id);
  if (!task) fail(`no task ${id} in ${path.join(p.dir, "tasks")}`);
  task.prPath = path.join(p.dir, "prs", path.basename(task.path));
  return task;
}

function slug(title) {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "task";
}

function canonical(key, value, config) {
  if (/[\r\n]/.test(value)) fail(`${key}: one line only`);
  if (!SETTABLE.includes(key)) fail(`"${key}" cannot be set; fields: ${SETTABLE.join(", ")}`);
  if (CHOICES[key]) {
    const hit = CHOICES[key].find((c) => c.toLowerCase() === value.toLowerCase());
    if (hit === undefined) fail(`${key} must be one of: ${CHOICES[key].filter(Boolean).join(", ")} (or empty)`);
    if (key === "status" && hit === "") fail(`status must be one of: ${STATUSES.join(", ")}`);
    return hit;
  }
  if (DATES.includes(key) && value && !DATE.test(value)) fail(`${key} must be a date, YYYY-MM-DD`);
  if (key === "title" && !value.trim()) fail("title cannot be empty");
  if (key === "phase" && value && (config.phases || []).length) {
    const hit = config.phases.find((ph) => ph.toLowerCase() === value.toLowerCase());
    if (!hit) fail(`phase must be one of: ${config.phases.join(", ")} (project.json phases)`);
    return hit;
  }
  return value.trim();
}

function saveTask(task) {
  fs.writeFileSync(task.path, formatTask(task.fields, task.body));
}

// Re-reads the task under the lock, applies changes, refreshes STATUS.md and commits AgentNotes.
function update(p, ctx, raw, changes, message) {
  withLock(p.root, () => {
    const task = findTask(p, raw);
    Object.assign(task.fields, changes);
    saveTask(task);
    writeStatus(p);
    commitNotes(ctx, p.root, p.repo.name, `${p.repo.name}: ${task.fields.id} ${message}`);
  });
}

// --------------------------------------------------------------------------------------- render

const PRIO = (t) => t.fields.priority || "P9";
const byPriority = (a, b) => PRIO(a).localeCompare(PRIO(b)) || a.fields.id.localeCompare(b.fields.id);
const isOpen = (t) => t.fields.status !== "Done";

function line(t, showPhase = true) {
  const tags = [];
  if (t.fields.priority) tags.push(t.fields.priority);
  if (showPhase && t.fields.phase) tags.push(t.fields.phase);
  if (t.fields.target) tags.push(`target ${t.fields.target}`);
  if (!isOpen(t)) tags.push("done");
  return `- [${t.fields.id}](${t.file}) ${t.fields.title}${tags.length ? ` · ${tags.join(" · ")}` : ""}`;
}

function section(title, items, limit) {
  items = [...items].sort(byPriority);
  const out = [`## ${title} (${items.length})`, ""];
  if (!items.length) out.push("- none");
  out.push(...(limit ? items.slice(0, limit) : items).map((t) => line(t)));
  if (limit && items.length > limit) out.push(`- … ${items.length - limit} more in tasks/`);
  out.push("");
  return out;
}

function renderStatus(tasks, name, config, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const open = tasks.filter(isOpen);
  const count = (s) => tasks.filter((t) => t.fields.status === s).length;
  const lines = [
    `# Status: ${name}`,
    "",
    `Generated ${today(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} (local time) by \`agent-board\` from the task files beside this one.`,
    "Do not edit: change a task with `agent-board set`.",
    "",
    `Board: ${STATUSES.map((s) => `${s} ${count(s)}`).join(" · ")}`,
    "",
  ];
  lines.push(...section("Now", open.filter((t) => t.fields.status === "Now")));
  lines.push(...section("In review", open.filter((t) => t.fields.status === "In review")));
  lines.push(...section("Waiting on the developer", open.filter((t) => t.fields.waiting === "developer")));
  lines.push(...section("NOT VERIFIED", tasks.filter((t) => t.fields.verification === "NOT VERIFIED"), 30));
  lines.push(...section("Next", open.filter((t) => t.fields.status === "Next")));
  lines.push("## Roadmap", "");
  const phases = [...(config.phases || [])];
  for (const t of tasks) if (t.fields.phase && !phases.includes(t.fields.phase)) phases.push(t.fields.phase);
  for (const phase of phases) {
    const inPhase = tasks.filter((t) => t.fields.phase === phase);
    if (!inPhase.length) continue;
    const done = inPhase.filter((t) => !isOpen(t)).length;
    const targets = inPhase.map((t) => t.fields.target).filter(Boolean).sort();
    lines.push(`### ${phase}: ${done}/${inPhase.length} done${targets.length ? `, target ${targets.at(-1)}` : ""}`, "");
    lines.push(...inPhase.filter(isOpen).sort(byPriority).map((t) => line(t, false)), "");
  }
  const unphased = open.filter((t) => !t.fields.phase).length;
  if (unphased) lines.push(`Open items with no phase: ${unphased}`, "");
  lines.push(...section("Backlog", open.filter((t) => t.fields.status === "Backlog"), 40));
  return lines.join("\n").trimEnd() + "\n";
}

function writeStatus(p) {
  fs.writeFileSync(path.join(p.dir, "STATUS.md"), renderStatus(listTasks(p.dir), p.repo.name, p.config));
}

// ------------------------------------------------------------------------------------- PR docs

function readPr(p, task) {
  if (!fs.existsSync(task.prPath)) fail(`no PR doc ${task.prPath}: run "agent-board start ${task.fields.id}" first`);
  const text = fs.readFileSync(task.prPath, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const todo = lines.findIndex((l) => /^\s*TODO\b/.test(l));
  if (todo >= 0) fail(`the PR doc still has TODO on line ${todo + 1}: ${task.prPath}`);
  const subject = lines[0].trim();
  if (!subject || subject.startsWith("#")) fail(`the PR doc's first line is the subject: ${task.prPath}`);
  if (p.config.subjectPattern && !new RegExp(p.config.subjectPattern).test(subject)) {
    fail(`the subject does not match project.json subjectPattern ${p.config.subjectPattern}: "${subject}"`);
  }
  let at = 0;
  for (const name of PR_SECTIONS) {
    const i = lines.indexOf(`## ${name}`, at);
    if (i < 0) fail(`the PR doc has no "## ${name}" section (in this order: ${PR_SECTIONS.join(", ")}): ${task.prPath}`);
    let end = lines.findIndex((l, j) => j > i && l.startsWith("## "));
    if (end < 0) end = lines.length;
    if (!lines.slice(i + 1, end).some((l) => l.trim())) fail(`"## ${name}" is empty in ${task.prPath} (write "none" if nothing applies)`);
    at = i + 1;
  }
  return { text: text.trimEnd(), subject };
}

// -------------------------------------------------------------------------------------- commands

function cmdInit(ctx, opts) {
  const repo = repoInfo(ctx);
  const root = ensureNotes(ctx, repo);
  const dir = path.join(root, repo.name);
  return withLock(root, () => {
    const file = path.join(dir, "project.json");
    let config;
    if (fs.existsSync(file)) {
      config = JSON.parse(fs.readFileSync(file, "utf8"));
      checkOwner(config, repo, dir);
    } else {
      const mainBranch = opts.main || detectMain(ctx, repo.main);
      if (!branchExists(ctx, repo.main, mainBranch)) fail(`no branch ${mainBranch} in ${repo.main}`);
      config = { repo: repo.main, mainBranch, merge: "no-ff", gate: "", subjectPattern: "", phases: [] };
      for (const d of ["tasks", "prs", "notes"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
      writeProject({ dir, config });
      writeStatus({ dir, repo, config });
    }
    commitNotes(ctx, root, repo.name, `${repo.name}: init`);
    ctx.out(`project ${repo.name}: ${dir} (main branch ${config.mainBranch}, gate ${config.gate || "not set"})\n`);
  });
}

function cmdConfig(ctx, pairs) {
  const p = loadProject(ctx);
  if (!pairs.length) return ctx.out(JSON.stringify(p.config, null, 2) + "\n");
  const changes = {};
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i < 1) fail(`"${pair}" is not key=value`);
    const key = pair.slice(0, i);
    const value = pair.slice(i + 1).trim();
    if (key === "mainBranch") {
      if (!branchExists(ctx, p.repo.main, value)) fail(`no branch ${value} in ${p.repo.main}`);
      changes[key] = value;
    } else if (key === "merge") {
      if (!MERGES.includes(value)) fail(`merge must be one of: ${MERGES.join(", ")}`);
      changes[key] = value;
    } else if (key === "subjectPattern") {
      try {
        new RegExp(value);
      } catch (e) {
        fail(`subjectPattern is not a regular expression: ${e.message}`);
      }
      changes[key] = value;
    } else if (key === "gate") {
      changes[key] = value;
    } else if (key === "phases") {
      changes[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      fail(`"${key}" is not a setting; settings: mainBranch, merge, gate, subjectPattern, phases`);
    }
  }
  withLock(p.root, () => {
    Object.assign(p.config, changes);
    writeProject(p);
    writeStatus(p);
    commitNotes(ctx, p.root, p.repo.name, `${p.repo.name}: config ${pairs.join(" ")}`);
  });
  ctx.out(JSON.stringify(p.config, null, 2) + "\n");
}

function cmdNew(ctx, title, opts) {
  if (!title || !title.trim()) fail('usage: agent-board new "<title>" [--priority P1] [--phase <name>] [--status <status>]');
  const p = loadProject(ctx);
  const fields = Object.fromEntries(FIELDS.map((f) => [f, ""]));
  fields.title = canonical("title", title, p.config);
  fields.status = canonical("status", opts.status || "Backlog", p.config);
  if (opts.priority) fields.priority = canonical("priority", opts.priority, p.config);
  if (opts.phase) fields.phase = canonical("phase", opts.phase, p.config);
  fields.created = today();
  const id = withLock(p.root, () => {
    const max = listTasks(p.dir).reduce((m, t) => Math.max(m, Number(t.fields.id.slice(2)) || 0), 0);
    fields.id = normalizeId(max + 1);
    const file = path.join(p.dir, "tasks", `${fields.id}-${slug(fields.title)}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatTask(fields, TASK_BODY), { flag: "wx" });
    writeStatus(p);
    commitNotes(ctx, p.root, p.repo.name, `${p.repo.name}: new ${fields.id} ${fields.title}`);
    return fields.id;
  });
  ctx.out(`${id} ${path.join(p.dir, "tasks", `${id}-${slug(fields.title)}.md`)}\n`);
}

function cmdSet(ctx, raw, pairs) {
  if (!raw || !pairs.length) fail("usage: agent-board set <id> key=value ...");
  const p = loadProject(ctx);
  findTask(p, raw);
  const changes = {};
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i < 1) fail(`"${pair}" is not key=value`);
    const key = pair.slice(0, i).trim();
    changes[key] = canonical(key, pair.slice(i + 1), p.config);
  }
  update(p, ctx, raw, changes, Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(" "));
  ctx.out(`${normalizeId(raw)}: ${Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(", ")}\n`);
}

function cmdShow(ctx, raw) {
  const p = loadProject(ctx);
  const t = findTask(p, raw);
  ctx.out(`task    ${t.path}\npr doc  ${t.prPath}${fs.existsSync(t.prPath) ? "" : " (not written yet)"}\n`);
  for (const f of FIELDS) if (t.fields[f]) ctx.out(`${f.padEnd(13)}${t.fields[f]}\n`);
}

function cmdBoard(ctx) {
  const p = loadProject(ctx);
  const tasks = listTasks(p.dir);
  for (const s of STATUSES) {
    let items = tasks.filter((t) => t.fields.status === s);
    items = s === "Done" ? items.sort((a, b) => b.fields.closed.localeCompare(a.fields.closed)).slice(0, 10) : items.sort(byPriority);
    const total = tasks.filter((t) => t.fields.status === s).length;
    ctx.out(`${s} (${total})${s === "Done" && total > 10 ? ", last 10" : ""}\n`);
    for (const t of items) {
      const tags = [t.fields.priority, t.fields.waiting === "developer" ? "[waiting on the developer]" : ""].filter(Boolean);
      ctx.out(`  ${t.fields.id} ${tags.length ? tags.join(" ") + " " : ""}${t.fields.title}\n`);
    }
  }
  ctx.out(`\n${path.join(p.dir, "STATUS.md")}\n`);
}

function cmdSnapshot(ctx) {
  const p = loadProject(ctx);
  withLock(p.root, () => {
    writeStatus(p);
    commitNotes(ctx, p.root, p.repo.name, `${p.repo.name}: snapshot`);
  });
  ctx.out(`${path.join(p.dir, "STATUS.md")}\n`);
}

function cmdStart(ctx, raw, opts) {
  const p = loadProject(ctx);
  const task = findTask(p, raw);
  const id = task.fields.id;
  if (task.fields.status === "Done") fail(`${id} is Done`);
  const main = p.config.mainBranch;
  const branch = task.fields.branch || `agent/${id}-${slug(task.fields.title)}`;
  const exists = branchExists(ctx, p.repo.main, branch);
  let where;
  if (opts.worktree) {
    const held = worktrees(ctx, p.repo.main).find((w) => w.branch === branch);
    if (held) where = held.path;
    else {
      where = path.join(path.dirname(p.repo.main), `${path.basename(p.repo.main)}-${id}`);
      if (fs.existsSync(where)) fail(`${where} exists and is not this task's worktree`);
      if (!exists) updateMain(ctx, p, opts["no-pull"]);
      git(ctx, p.repo.main, exists ? ["worktree", "add", "-q", where, branch] : ["worktree", "add", "-q", "-b", branch, where, main]);
    }
  } else {
    where = p.repo.top;
    if (!clean(ctx, where)) fail(`${where} has uncommitted changes: commit or park them (or ask the developer) before starting ${id}`);
    if (!exists) updateMain(ctx, p, opts["no-pull"]);
    const current = gitTry(ctx, where, ["branch", "--show-current"]);
    if (current !== branch) git(ctx, where, exists ? ["switch", "-q", branch] : ["switch", "-q", "-c", branch, main]);
  }
  withLock(p.root, () => {
    const t = findTask(p, id);
    if (!fs.existsSync(t.prPath)) {
      fs.mkdirSync(path.dirname(t.prPath), { recursive: true });
      fs.writeFileSync(t.prPath, PR_SKELETON);
    }
    Object.assign(t.fields, { status: "Now", branch, start: t.fields.start || today() });
    saveTask(t);
    writeStatus(p);
    commitNotes(ctx, p.root, p.repo.name, `${p.repo.name}: ${id} started on ${branch}`);
  });
  ctx.out(`${id} started: branch ${branch} in ${where}\nPR doc: ${task.prPath}\n`);
}

function branchCheckout(ctx, p, branch) {
  return worktrees(ctx, p.repo.main).find((w) => w.branch === branch);
}

function cmdFinish(ctx, raw) {
  const p = loadProject(ctx);
  const task = findTask(p, raw);
  const id = task.fields.id;
  const branch = task.fields.branch;
  if (!["Now", "In review"].includes(task.fields.status) || !branch) fail(`${id} is ${task.fields.status}: start it first`);
  const pr = readPr(p, task);
  if (!branchExists(ctx, p.repo.main, branch)) fail(`branch ${branch} does not exist`);
  const ahead = Number(git(ctx, p.repo.main, ["rev-list", "--count", `${p.config.mainBranch}..${branch}`]));
  if (!ahead) fail(`no commits on ${branch} that ${p.config.mainBranch} does not have`);
  const holder = branchCheckout(ctx, p, branch);
  if (holder && !clean(ctx, holder.path)) fail(`${holder.path} has uncommitted changes on ${branch}: commit them first`);
  update(p, ctx, id, { status: "In review" }, "In review");
  ctx.out(
    `${id} is In review. Ask the developer to merge it: "${pr.subject}" (${ahead} commit${ahead > 1 ? "s" : ""} on ${branch}), PR doc ${task.prPath}\n` +
      `Merge only after they say so: agent-board merge ${id} --author "<Name> <email>"\n`,
  );
}

function cmdMerge(ctx, raw, opts) {
  const p = loadProject(ctx);
  const task = findTask(p, raw);
  const id = task.fields.id;
  const main = p.config.mainBranch;
  const branch = task.fields.branch;
  if (task.fields.status !== "In review") {
    fail(`${id} is ${task.fields.status}, not In review: run "agent-board finish ${id}" and merge only after the developer approves`);
  }
  const pr = readPr(p, task);
  const noGate = typeof opts["no-gate"] === "string" ? opts["no-gate"].trim() : "";
  if (!p.config.gate && !noGate) {
    fail('no gate in project.json: set one (agent-board config gate="<command>") or pass --no-gate "<reason>"');
  }
  let identity = { config: [], author: [] };
  if (opts.author) {
    const m = /^(.+?)\s*<([^<>\s]+)>$/.exec(opts.author.trim());
    if (!m) fail('--author must look like "Name <email>"');
    identity = { config: ["-c", `user.name=${m[1]}`, "-c", `user.email=${m[2]}`], author: [`--author=${m[1]} <${m[2]}>`] };
  }
  if (!branchExists(ctx, p.repo.main, branch)) fail(`branch ${branch} does not exist`);

  let at = branchCheckout(ctx, p, main);
  if (!at) {
    at = { path: p.repo.main };
    if (!clean(ctx, at.path)) fail(`${at.path} has uncommitted changes; ${main} cannot be checked out there`);
    git(ctx, at.path, ["switch", "-q", main]);
  } else if (!clean(ctx, at.path)) {
    fail(`${at.path} (${main}) has uncommitted changes: the developer's; ask before merging`);
  }
  updateMain(ctx, p, opts["no-pull"]);
  if (!Number(git(ctx, at.path, ["rev-list", "--count", `${main}..${branch}`]))) fail(`${branch} has nothing ${main} does not have`);
  const before = git(ctx, at.path, ["rev-parse", "HEAD"]);
  const undo = () => {
    gitTry(ctx, at.path, ["reset", "-q", "--merge"]);
    gitTry(ctx, at.path, ["reset", "-q", "--hard", before]);
  };

  const mergeArgs = p.config.merge === "squash" ? ["merge", "-q", "--squash", branch] : ["merge", "-q", "--no-ff", "--no-commit", branch];
  const merged = spawnSync("git", mergeArgs, { cwd: at.path, env: ctx.env, encoding: "utf8" });
  if (merged.status !== 0) {
    undo();
    fail(`merge conflict between ${branch} and ${main}: merged nothing. Merge ${main} into ${branch}, resolve it there, commit, then finish and merge again`);
  }
  if (p.config.gate) {
    const g = spawnSync(p.config.gate, { cwd: at.path, env: ctx.env, shell: true, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (g.status !== 0) {
      undo();
      const tail = `${g.stdout || ""}${g.stderr || ""}`.trimEnd().split("\n").slice(-40).join("\n");
      fail(`gate failed (${p.config.gate}, exit ${g.status}): merged nothing; ${id} stays In review.\n${tail}`);
    }
  }
  const message = `${pr.text}\n${noGate ? `\nNOT VERIFIED: gate: ${noGate}\n` : ""}\nTask: ${id}\n`;
  const msgFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agent-board-")), "message.txt");
  fs.writeFileSync(msgFile, message);
  const committed = spawnSync("git", [...identity.config, "commit", "-q", ...identity.author, "--cleanup=whitespace", "-F", msgFile], {
    cwd: at.path,
    env: ctx.env,
    encoding: "utf8",
  });
  fs.rmSync(path.dirname(msgFile), { recursive: true, force: true });
  if (committed.status !== 0) {
    undo();
    fail(`the commit failed: merged nothing. ${String(committed.stderr || committed.stdout).trim()}`);
  }
  const sha = git(ctx, at.path, ["rev-parse", "--short", "HEAD"]);

  const notes = [];
  const holder = branchCheckout(ctx, p, branch);
  if (holder && !samePath(holder.path, p.repo.main)) {
    if (gitTry(ctx, p.repo.main, ["worktree", "remove", holder.path]) === null) notes.push(`kept the worktree ${holder.path}: it has changes`);
  }
  if (!branchCheckout(ctx, p, branch)) {
    const del = p.config.merge === "squash" ? "-D" : "-d";
    if (gitTry(ctx, p.repo.main, ["branch", del, branch]) === null) notes.push(`kept the branch ${branch}`);
  }
  update(p, ctx, id, { status: "Done", closed: today() }, `merged as ${sha}`);
  ctx.out(`merged ${id} into ${main}: ${sha} ${pr.subject}\n${notes.map((n) => `note: ${n}\n`).join("")}`);
}

// ------------------------------------------------------------------------------------------ CLI

const VALUE_FLAGS = new Set(["priority", "phase", "status", "main", "author", "no-gate"]);
const BOOL_FLAGS = new Set(["worktree", "no-pull"]);
const HELP = fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//   ")).map((l) => l.slice(5)).join("\n");

function parseArgs(args) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (BOOL_FLAGS.has(name)) opts[name] = true;
    else if (VALUE_FLAGS.has(name)) {
      const value = eq > 0 ? a.slice(eq + 1) : args[++i];
      if (value === undefined) fail(`--${name} needs a value`);
      opts[name] = value;
    } else fail(`unknown option --${name}`);
  }
  return { pos, opts };
}

function main(argv, ctx) {
  try {
    const { pos, opts } = parseArgs(argv);
    const [cmd, ...rest] = pos;
    switch (cmd) {
      case "init":
        cmdInit(ctx, opts);
        break;
      case "config":
        cmdConfig(ctx, rest);
        break;
      case "new":
        cmdNew(ctx, rest.join(" "), opts);
        break;
      case "set":
        cmdSet(ctx, rest[0], rest.slice(1));
        break;
      case "show":
        cmdShow(ctx, rest[0]);
        break;
      case "board":
        cmdBoard(ctx);
        break;
      case "snapshot":
        cmdSnapshot(ctx);
        break;
      case "start":
        cmdStart(ctx, rest[0], opts);
        break;
      case "finish":
        cmdFinish(ctx, rest[0]);
        break;
      case "merge":
        cmdMerge(ctx, rest[0], opts);
        break;
      case undefined:
      case "help":
        ctx.out(`agent-board: tasks, PR docs and STATUS.md in AgentNotes (${notesRoot(ctx.env)})\n\n${HELP}\n`);
        break;
      default:
        fail(`unknown command "${cmd}"; run agent-board help`);
    }
    return 0;
  } catch (e) {
    if (!(e instanceof BoardError)) throw e;
    ctx.err(`agent-board: ${e.message}\n`);
    return 1;
  }
}

module.exports = { main, parseTask, formatTask, renderStatus, today, FIELDS, COMMANDS: ["init", "config", "new", "set", "show", "board", "snapshot", "start", "finish", "merge", "help"] };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
