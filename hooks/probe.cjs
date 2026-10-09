#!/usr/bin/env node
// probe: step 1 of docs/global-rules-plan.md. Answers two questions in a cloud session:
//   1. Does a SessionStart hook registered in the user-level ~/.claude/settings.json run?
//   2. Can a hook reach github.com (so global-sync can fetch a new tag)?
// The answers land in Claude's context, because Claude Code adds a SessionStart hook's stdout to it.
//
// Usage:
//   node probe.cjs --install   merge this hook into $HOME/.claude/settings.json (run by the setup script)
//   node probe.cjs             the hook itself (stdin: the SessionStart event as JSON)
//
// Throwaway: global-sync.cjs (step 2) replaces it and reuses mergeSettings. Never fails a session:
// every path exits 0.
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Hook entries whose command points into ~/.claude/hooks/ belong to claude-global; merging
// replaces those and leaves every other entry and key alone.
const OWNED = "/.claude/hooks/";

const FRAGMENT = {
  hooks: {
    SessionStart: [
      {
        matcher: "startup",
        hooks: [{ type: "command", command: 'node "$HOME/.claude/hooks/probe.cjs"', timeout: 10 }],
      },
    ],
  },
};

function isOwned(group) {
  return (group.hooks || []).some((h) => typeof h.command === "string" && h.command.includes(OWNED));
}

function mergeSettings(settings, fragment) {
  settings.hooks = settings.hooks || {};
  for (const [event, groups] of Object.entries(fragment.hooks)) {
    const kept = (settings.hooks[event] || []).filter((g) => !isOwned(g));
    settings.hooks[event] = [...kept, ...structuredClone(groups)];
  }
  return settings;
}

function install() {
  const file = path.join(process.env.HOME || "", ".claude", "settings.json");
  let settings = {};
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      console.log(`probe: ${file} is not valid JSON; left untouched.`);
      return;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(mergeSettings(settings, FRAGMENT), null, 2) + "\n");
  fs.renameSync(tmp, file);
  console.log(`probe: registered in ${file}`);
}

function hook() {
  let source = "unknown";
  try {
    source = JSON.parse(fs.readFileSync(0, "utf8")).source || source;
  } catch {}
  const remote = process.env.PROBE_REMOTE || "https://github.com/enjay27/claude-global";
  const started = Date.now();
  let reach;
  try {
    execFileSync("git", ["ls-remote", "--heads", remote], { stdio: "ignore", timeout: 5000 });
    reach = `yes (${Date.now() - started} ms)`;
  } catch {
    reach = `no (${Date.now() - started} ms)`;
  }
  console.log(`Probe: user-level SessionStart hook ran (source=${source}).`);
  console.log(`Probe: github.com reachable: ${reach}.`);
}

if (require.main === module) {
  try {
    process.argv.includes("--install") ? install() : hook();
  } catch (e) {
    console.log(`probe: ${e.message}`);
  }
  process.exit(0);
}

module.exports = { FRAGMENT, mergeSettings };
