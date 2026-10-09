// Run: node --test scripts/repo.test.cjs
// Checks on this repository itself (docs/global-rules-plan.md, section 5): nothing tracked can reach
// ~/.claude unless the allowlist lets it, and the setup script checks out what the allowlist allows.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { readStamp } = require("../hooks/global-sync.cjs");

const ROOT = path.join(__dirname, "..");
// Tracked but never deployed: the sparse checkout in ~/.claude leaves these out.
const DEV_ONLY = ["setup/", "scripts/", "docs/", ".github/", "README.md", "deploy-exclude"];

function git(args, input) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}

const tracked = git(["ls-files"]).split("\n").filter(Boolean);

// Tracked paths the deploy allowlist would ignore in ~/.claude.
function excluded(paths) {
  const exclude = path.join(ROOT, "deploy-exclude");
  try {
    return git(["-c", `core.excludesFile=${exclude}`, "check-ignore", "--no-index", "--stdin"], paths.join("\n"))
      .split("\n")
      .filter(Boolean);
  } catch (e) {
    if (e.status === 1) return []; // none ignored
    throw e;
  }
}

const devOnly = (f) => DEV_ONLY.some((d) => (d.endsWith("/") ? f.startsWith(d) : f === d));

test("every tracked file is either allowed in ~/.claude or development-only", () => {
  const ignored = new Set(excluded(tracked));
  const stray = tracked.filter((f) => ignored.has(f) && !devOnly(f));
  assert.deepStrictEqual(stray, [], "add these to deploy-exclude or DEV_ONLY, deliberately");
  const leaking = tracked.filter((f) => devOnly(f) && !ignored.has(f));
  assert.deepStrictEqual(leaking, [], "development-only files the allowlist would let into ~/.claude");
});

test("the setup script checks out exactly the allowed top-level paths", () => {
  const script = fs.readFileSync(path.join(ROOT, "setup", "cloud-setup.sh"), "utf8");
  const sparse = /sparse-checkout set --no-cone (.+)/.exec(script)[1].trim().split(/\s+/);
  const deployable = tracked.filter((f) => !devOnly(f));
  for (const f of deployable) {
    assert.ok(
      sparse.some((p) => (p.endsWith("/") ? `/${f}`.startsWith(p) : `/${f}` === p)),
      `${f} is allowed but not in the setup script's sparse-checkout list`
    );
  }
});

test("CLAUDE.md, when present, starts with a release stamp", () => {
  const file = path.join(ROOT, "CLAUDE.md");
  if (!fs.existsSync(file)) return;
  assert.ok(readStamp(fs.readFileSync(file, "utf8")), 'line 1 must be "Global rules: vYYYY.MM.DD"');
});
