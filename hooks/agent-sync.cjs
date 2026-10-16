// agent-sync: keeps the other agents' copies of the global rules and skills, from ~/.claude
// (docs/agent-migration-plan.md, step 9). It has no hook of its own: global-sync calls it on every
// run, after any update, because Antigravity's IDE ran no hook in step 3.
//
// For each agent in ~/.claude/agents.json:
// - rules: writes `text`, the one-line include of ~/.claude/AGENTS.md, to `path`. A file there with
//   other content is left alone, with one line.
// - skills: copies ~/.claude/agent-skills/* into each folder listed and names them in .agent-sync.json
//   there. Only the skills that file names are updated or removed; a folder of the same name it did
//   not copy is left alone, with one line.
// A path is used only if its parent folder exists, so an agent that is not installed gets nothing.
// Paths start with ~/, the home folder: the folder above ~/.claude.
"use strict";

const fs = require("fs");
const path = require("path");

const MANIFEST = ".agent-sync.json";

function expand(p, home) {
  return p.startsWith("~/") ? path.join(home, p.slice(2)) : p;
}

function readOr(file, fallback) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

// Every file under dir, as relative path -> contents; null when dir is missing.
function tree(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = {};
  for (const rel of fs.readdirSync(dir, { recursive: true })) {
    const full = path.join(dir, rel);
    if (fs.statSync(full).isFile()) files[rel] = fs.readFileSync(full, "utf8");
  }
  return files;
}

const sameTree = (a, b) => JSON.stringify(tree(a)) === JSON.stringify(tree(b));

function writeRules({ name, rules }, home) {
  const file = expand(rules.path, home);
  if (!fs.existsSync(path.dirname(file))) return [];
  const text = readOr(file, null);
  if (text === null) {
    fs.writeFileSync(file, rules.text);
    return [];
  }
  if (text.replace(/\r\n/g, "\n") === rules.text) return [];
  return [`agent-sync: ${rules.path} is not the one line that includes the global rules; left untouched, so ${name} does not read them.`];
}

function copySkills(from, skills, folder, dest) {
  if (!fs.existsSync(path.dirname(dest))) return [];
  fs.mkdirSync(dest, { recursive: true });
  const manifest = path.join(dest, MANIFEST);
  let owned = [];
  try {
    owned = JSON.parse(readOr(manifest, "{}")).skills || [];
  } catch {
    // unreadable: claim nothing, so nothing of anyone else's is removed
  }
  for (const name of owned) {
    if (!skills.includes(name)) fs.rmSync(path.join(dest, name), { recursive: true, force: true });
  }
  const out = [];
  const copied = [];
  for (const name of skills) {
    const src = path.join(from, name);
    const to = path.join(dest, name);
    if (!owned.includes(name) && fs.existsSync(to)) {
      out.push(`agent-sync: ${folder}/${name} is not a copy agent-sync made; left untouched.`);
      continue;
    }
    if (!sameTree(src, to)) {
      fs.rmSync(to, { recursive: true, force: true });
      fs.cpSync(src, to, { recursive: true });
    }
    copied.push(name);
  }
  const text = JSON.stringify({ skills: copied }, null, 2) + "\n";
  if (readOr(manifest, null) !== text) fs.writeFileSync(manifest, text);
  return out;
}

// Returns the lines to print: none when everything is as it should be.
function sync(source, home) {
  const config = JSON.parse(fs.readFileSync(path.join(source, "agents.json"), "utf8"));
  const from = path.join(source, "agent-skills");
  const skills = fs.existsSync(from)
    ? fs.readdirSync(from, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];
  const out = [];
  for (const agent of config.agents || []) {
    if (agent.rules) out.push(...writeRules(agent, home));
    for (const folder of agent.skills || []) out.push(...copySkills(from, skills, folder, expand(folder, home)));
  }
  return out;
}

module.exports = { sync };
