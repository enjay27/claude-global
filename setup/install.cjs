#!/usr/bin/env node
// install: puts the local-config rules, skills, hook and tool in place on a developer's PC, and
// sets up one repository at a time. Run it from a clone of the local-config branch:
//
//   node setup\install.cjs                    install or update ~/.claude, and ~/.pi/agent if Pi is installed
//   node setup\install.cjs --dry-run          say what it would change; write nothing
//   node setup\install.cjs --repo <path> [--main <branch>]
//                                             one repository: LF attributes in .git\info\attributes,
//                                             and its project in AgentNotes (agent-board init)
//
// To update: git pull in the clone, then run it again.
//
// It writes only files it installed and has not been edited since (a hash list in
// .local-config.json in each folder), or new ones. Anything else in the way stops it before it
// writes anything. In ~/.claude/settings.json it replaces only hook entries whose command points
// into ~/.claude/hooks/. LOCAL_CONFIG_HOME replaces the home folder (tests).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MANIFEST = ".local-config.json";
const OWNED = "/.claude/hooks/";
const BLOCK_START = "# >>> local-config (install.cjs --repo): text is committed with LF; batch files as they are";
const BLOCK_END = "# <<< local-config";
const ATTRIBUTES = ["* text=auto eol=lf", "*.bat -text", "*.cmd -text"];

const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");

function filesUnder(dir, prefix) {
  const out = {};
  for (const rel of fs.readdirSync(dir, { recursive: true }).sort()) {
    const full = path.join(dir, rel);
    if (fs.statSync(full).isFile() && !rel.endsWith(".test.cjs")) out[`${prefix}/${rel.split(path.sep).join("/")}`] = fs.readFileSync(full, "utf8");
  }
  return out;
}

function targets(home) {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  const skills = filesUnder(path.join(ROOT, "skills"), "skills");
  return [
    {
      name: "Claude Code",
      dir: path.join(home, ".claude"),
      always: true,
      settings: JSON.parse(read("settings.global.json")),
      files: {
        "AGENTS.md": read("AGENTS.md"),
        "CLAUDE.md": read("CLAUDE.md"),
        "hooks/context-guard.cjs": read("hooks/context-guard.cjs"),
        "tools/agent-board.cjs": read("tools/agent-board.cjs"),
        ...skills,
      },
    },
    {
      name: "Pi",
      dir: path.join(home, ".pi", "agent"),
      always: false,
      files: { "AGENTS.md": read("AGENTS.md"), ...skills },
    },
  ];
}

function isOwned(group) {
  return (group.hooks || []).some((h) => typeof h.command === "string" && h.command.includes(OWNED));
}

// Moved from hooks/global-sync.cjs (main): owned entries out of every event, then the fragment's in.
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

// What one target needs: writes, removals, conflicts and notes. Reads only.
function plan(target, version) {
  const p = { target, writes: {}, removes: [], conflicts: [], notes: [], manifest: null, settings: null };
  if (target.name === "Claude Code" && fs.existsSync(path.join(target.dir, ".git"))) {
    p.conflicts.push(`${target.dir} is a git checkout (the GitHub setup's releases); this installer is for PCs without it`);
    return p;
  }
  let old = { files: {} };
  try {
    old = JSON.parse(fs.readFileSync(path.join(target.dir, MANIFEST), "utf8"));
  } catch {}
  const files = {};
  for (const [rel, text] of Object.entries(target.files)) {
    const full = path.join(target.dir, rel);
    const cur = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
    files[rel] = hash(text);
    if (cur === text) continue;
    if (cur === null || old.files[rel] === hash(cur)) p.writes[rel] = text;
    else if (old.files[rel]) p.conflicts.push(`${full} changed since it was installed; move your changes out (or delete it) and run again`);
    else p.conflicts.push(`${full} is not from this installer; move it away and run again (your own rules can go in ~/.claude/rules/)`);
  }
  for (const [rel, h] of Object.entries(old.files || {})) {
    if (rel in target.files) continue;
    const full = path.join(target.dir, rel);
    if (!fs.existsSync(full)) continue;
    if (hash(fs.readFileSync(full, "utf8")) === h) p.removes.push(rel);
    else p.notes.push(`kept ${rel}: no longer installed, but edited since`);
  }
  const manifest = { version, files };
  if (JSON.stringify(manifest) !== JSON.stringify(old)) p.manifest = manifest;
  if (target.settings) {
    const file = path.join(target.dir, "settings.json");
    let current = {};
    let text = null;
    if (fs.existsSync(file)) {
      text = fs.readFileSync(file, "utf8");
      try {
        current = JSON.parse(text);
      } catch (e) {
        p.conflicts.push(`${file} is not valid JSON (${e.message}); fix it and run again`);
        return p;
      }
    }
    const merged = JSON.stringify(mergeSettings(structuredClone(current), target.settings), null, 2) + "\n";
    if (text === null || JSON.stringify(JSON.parse(merged)) !== JSON.stringify(current)) p.settings = merged;
  }
  return p;
}

function removeEmptyParents(dir, stop) {
  while (path.resolve(dir) !== path.resolve(stop) && fs.existsSync(dir) && !fs.readdirSync(dir).length) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

function apply(p) {
  const dir = p.target.dir;
  for (const [rel, text] of Object.entries(p.writes)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  for (const rel of p.removes) {
    fs.rmSync(path.join(dir, rel));
    removeEmptyParents(path.dirname(path.join(dir, rel)), dir);
  }
  if (p.settings) fs.writeFileSync(path.join(dir, "settings.json"), p.settings);
  if (p.manifest) fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(p.manifest, null, 2) + "\n");
}

function report(p, ctx, dry) {
  const would = dry ? "would " : "";
  const lines = [
    ...Object.keys(p.writes).map((rel) => `${would}write ${rel}`),
    ...p.removes.map((rel) => `${would}remove ${rel}`),
    ...(p.settings ? [`${would}update settings.json (hook entries)`] : []),
    ...p.notes,
  ];
  ctx.out(`${p.target.name}: ${lines.length ? p.target.dir : "up to date"}\n${lines.map((l) => `  ${l}\n`).join("")}`);
}

function installAll(ctx, dry) {
  const home = path.resolve(ctx.env.LOCAL_CONFIG_HOME || os.homedir());
  const version = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8").split("\n")[0];
  const plans = [];
  for (const t of targets(home)) {
    if (!t.always && !fs.existsSync(t.dir)) {
      ctx.out(`${t.name}: not installed (${t.dir} does not exist); skipped\n`);
      continue;
    }
    plans.push(plan(t, version));
  }
  const conflicts = plans.flatMap((p) => p.conflicts);
  if (conflicts.length) {
    ctx.err(`install: nothing was changed:\n${conflicts.map((c) => `  ${c}\n`).join("")}`);
    return 1;
  }
  for (const p of plans) {
    if (!dry) apply(p);
    report(p, ctx, dry);
  }
  ctx.out(`${version}\n`);
  return 0;
}

function git(ctx, cwd, args) {
  return spawnSync("git", args, { cwd, env: ctx.env, encoding: "utf8" });
}

function setupRepo(ctx, repoArg, mainBranch) {
  const repo = path.resolve(repoArg);
  const top = git(ctx, repo, ["rev-parse", "--show-toplevel"]);
  if (!fs.existsSync(repo) || top.status !== 0) {
    ctx.err(`install: ${repo} is not a git repository\n`);
    return 1;
  }
  const attrPath = path.resolve(repo, git(ctx, repo, ["rev-parse", "--git-path", "info/attributes"]).stdout.trim());
  const old = fs.existsSync(attrPath) ? fs.readFileSync(attrPath, "utf8").replace(/\r\n/g, "\n") : "";
  const block = [BLOCK_START, ...ATTRIBUTES, BLOCK_END].join("\n");
  const start = old.indexOf(BLOCK_START);
  const end = old.indexOf(BLOCK_END);
  let text;
  if (start >= 0 && end > start) text = old.slice(0, start) + block + old.slice(end + BLOCK_END.length);
  else text = `${old}${old && !old.endsWith("\n") ? "\n" : ""}${block}\n`;
  if (text !== old) {
    fs.mkdirSync(path.dirname(attrPath), { recursive: true });
    fs.writeFileSync(attrPath, text);
    ctx.out(`wrote the LF attributes to ${attrPath}\n`);
  } else ctx.out(`${attrPath}: up to date\n`);
  const eol = git(ctx, repo, ["ls-files", "--eol"]).stdout;
  const crlf = eol.split("\n").filter((l) => /^i\/(crlf|mixed)\s/.test(l) && !/\battr\/-text\b/.test(l)).length;
  if (crlf) {
    ctx.out(
      `note: ${crlf} file${crlf > 1 ? "s are" : " is"} stored with CRLF in this repository; a commit that touches one ` +
        `stores it with LF, so its whole content shows as changed (git ls-files --eol lists them)\n`,
    );
  }
  const board = require(path.join(ROOT, "tools", "agent-board.cjs"));
  return board.main(["init", ...(mainBranch ? ["--main", mainBranch] : [])], { cwd: repo, env: ctx.env, out: ctx.out, err: ctx.err });
}

function main(argv, ctx) {
  const i = argv.indexOf("--repo");
  if (i >= 0) {
    if (!argv[i + 1]) {
      ctx.err("install: --repo needs a path\n");
      return 1;
    }
    const m = argv.indexOf("--main");
    return setupRepo(ctx, argv[i + 1], m >= 0 ? argv[m + 1] : "");
  }
  const unknown = argv.filter((a) => a !== "--dry-run");
  if (unknown.length) {
    ctx.err(`install: unknown argument ${unknown[0]}; see the top of setup/install.cjs\n`);
    return 1;
  }
  return installAll(ctx, argv.includes("--dry-run"));
}

module.exports = { main, mergeSettings };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    env: process.env,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
