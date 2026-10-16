#!/usr/bin/env node
// cg: the code-graph skill's wrapper around code-review-graph (PyPI), pinned to VERSION.
//
// Usage, from anywhere inside a git repository:
//   node cg.cjs build                 build the graph, or update it; prints one line
//   node cg.cjs callers <target>      who calls it (one line per call site)
//   node cg.cjs callees <target>      what it calls
//   node cg.cjs tests <target>        the tests that reach it
//   node cg.cjs skeleton <file>       a file's definitions with their line spans
//   node cg.cjs search <text>         ranked definitions matching the words
//   node cg.cjs impact [--base <ref>] what the branch's changes reach, for a PR's blast radius
//   node cg.cjs version
// A target is a name (`resume`) or a repository-relative file and a name (`src/engine.rs::Engine.step`).
//
// The tool is installed on first use into its own virtual environment under the cache, one per
// pinned version, so nothing is installed by hand. The graph of each repository lives in the cache
// too (CRG_DATA_DIR), so the working tree stays clean. Queries update the graph first.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const VERSION = "2.3.9";
// Extensions code-review-graph does not map yet, added to its parser's map before the CLI runs.
// 2.3.9 maps .js and .mjs but not .cjs; drop the entry once a release maps it.
const EXTRA_EXTENSIONS = { ".cjs": "javascript" };
const BOOTSTRAP = [
  "import json, sys",
  "import code_review_graph.parser as p",
  `for ext, lang in json.loads(${JSON.stringify(JSON.stringify(EXTRA_EXTENSIONS))}).items():`,
  "    p.EXTENSION_TO_LANGUAGE.setdefault(ext, lang)",
  "from code_review_graph.cli import main",
  'sys.argv = ["code-review-graph"] + sys.argv[1:]',
  "sys.exit(main())",
].join("\n");
const NOUNS = { callers: "caller", callees: "callee", tests: "test" };
const PATTERNS = { callers: "callers_of", callees: "callees_of", tests: "tests_for" };

// ---- paths --------------------------------------------------------------------------------

function cacheRoot(env, home) {
  return path.join(env.XDG_CACHE_HOME || path.join(home, ".cache"), "code-review-graph");
}

function dataDir(root, cache) {
  return path.join(cache, "graphs", root.replace(/[\\/:]/g, "_"));
}

function venvDir(cache) {
  return path.join(cache, `venv-${VERSION}`);
}

function venvExe(venv, platform) {
  return platform === "win32"
    ? path.join(venv, "Scripts", "code-review-graph.exe")
    : path.join(venv, "bin", "code-review-graph");
}

function venvPython(venv, platform) {
  return platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

// [command, args] that run code-review-graph with EXTRA_EXTENSIONS mapped.
function toolCommand(venv, platform, args) {
  return [venvPython(venv, platform), ["-c", BOOTSTRAP, ...args]];
}

function slash(p) {
  return p.replace(/\\/g, "/");
}

function rel(p, root) {
  const s = slash(p);
  const r = slash(root).replace(/\/$/, "") + "/";
  return s.startsWith(r) ? s.slice(r.length) : s;
}

function toTarget(arg, root) {
  const at = arg.indexOf("::");
  if (at < 0) return arg;
  const file = slash(arg.slice(0, at));
  const absolute = file.startsWith("/") || /^[A-Za-z]:\//.test(file);
  return `${absolute ? file : `${slash(root)}/${file}`}::${arg.slice(at + 2)}`;
}

// ---- output -------------------------------------------------------------------------------

function buildLine(out) {
  const lines = out.split(/\r?\n/).filter((l) => /^(Full build|Incremental):/.test(l));
  return lines.length ? lines[lines.length - 1] : null;
}

function label(node) {
  return node.parent_name ? `${node.parent_name}.${node.name}` : node.name;
}

function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// code-review-graph's candidates for an ambiguous name also hold near names, so only the exact
// ones count as its definitions. `asked` is the target as given.
function exactCandidates(json, asked) {
  const name = asked.split("::").pop().split(".").pop();
  return (json.candidates || []).filter((c) => c.name === name);
}

// The qualified name to ask again with when an "ambiguous" answer has one exact definition.
function soleDefinition(json, asked) {
  if (json.status !== "ambiguous") return null;
  const exact = exactCandidates(json, asked);
  return exact.length === 1 ? exact[0].qualified_name : null;
}

function formatQuery(json, root, command, asked = "") {
  if (json.status === "ambiguous") {
    const name = asked.split("::").pop();
    const exact = exactCandidates(json, asked);
    const rows = (exact.length ? exact : json.candidates)
      .map((c) => [rel(c.qualified_name, root), c.line_start])
      .sort((a, b) => a[0].localeCompare(b[0]));
    const head = exact.length ? `has ${exact.length} definitions` : "has no exact match";
    return [`${name} ${head}; ask again with one of:`, ...rows.map(([q, line]) => `  ${q}  (line ${line})`)];
  }
  if (json.status !== "ok") return [json.summary || `code-review-graph: ${json.status}`];

  const target = rel(json.target, root);
  const bare = target.split("::").pop().split(".").pop();
  const rows = json.results
    .map((r) => ({
      file: rel(r.file_path, root),
      line: r.call_site ? r.call_site.line : r.line_start,
      text: label(r) + (r.is_test ? "  [test]" : "") + (r.target_resolution === "unresolved" ? " ?" : ""),
      guessed: r.target_resolution === "unresolved",
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const out = [`${target}: ${plural(rows.length, NOUNS[command])}`];
  if (!rows.length) {
    out.push(
      "  none in the graph; calls across languages (GDScript to Rust) and through a variable are " +
        `not tracked: git grep -n "${bare}("`
    );
    return out;
  }
  for (const r of rows) out.push(`  ${r.file}:${r.line}  ${r.text}`);
  const guessed = rows.filter((r) => r.guessed).length;
  if (guessed) {
    out.push(
      `? = matched by name only (${guessed} of ${rows.length}): there may be another function named ` +
        `${bare}, so check each one.`
    );
    out.push(`  confirm with: git grep -n "${bare}("`);
  }
  return out;
}

function formatSkeleton(json) {
  if (json.status !== "ok") return [json.summary || `code-review-graph: ${json.status}`];
  return json.results
    .filter((r) => r.kind !== "File")
    .sort((a, b) => a.line_start - b.line_start)
    .map((r) => `L${r.line_start}-L${r.line_end}  ${r.kind}  ${label(r)}`);
}

function formatSearch(json, root) {
  if (json.status !== "ok") return [json.summary || `code-review-graph: ${json.status}`];
  return json.results.map((r) => `${rel(r.file_path, root)}:${r.line_start}  ${r.kind}  ${label(r)}`);
}

function formatImpact(impact, changes, root) {
  const out = [];
  for (const s of [impact.summary, changes && changes.summary]) if (s) out.push(...s.split(/\r?\n/));
  const changed = new Set((impact.changed_files || []).map((f) => rel(f, root)));
  const reached = (impact.impacted_nodes || []).filter((n) => n.kind !== "File" && !changed.has(rel(n.file_path, root)));
  out.push("Reached outside the changed files:");
  if (!reached.length) out.push("  nothing");
  for (const n of reached) out.push(`  ${rel(n.file_path, root)}:${n.line_start}  ${label(n)}`);
  return out;
}

// ---- running the tool ---------------------------------------------------------------------

function fail(message) {
  console.error(`cg: ${message}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}

function findPython() {
  for (const cmd of ["python3", "python", "py"]) {
    const r = run(cmd, ["-c", "import sys; print(sys.version_info >= (3, 10))"]);
    if (r.status === 0 && r.stdout.trim() === "True") return cmd;
  }
  return null;
}

function ensureTool(cache) {
  const venv = venvDir(cache);
  const exe = venvExe(venv, process.platform);
  if (fs.existsSync(exe)) return venv;
  const python = findPython();
  if (!python) fail("code-review-graph needs Python 3.10 or newer, and none was found on PATH.");
  console.error(`cg: installing code-review-graph ${VERSION} into ${venv} (first use, about a minute)`);
  fs.mkdirSync(cache, { recursive: true });
  let r = run(python, ["-m", "venv", venv]);
  if (r.status !== 0) fail(`creating the virtual environment failed:\n${r.stderr}`);
  r = run(venvPython(venv, process.platform),["-m", "pip", "install", "--disable-pip-version-check", "-q", `code-review-graph==${VERSION}`]);
  if (r.status !== 0 || !fs.existsSync(exe)) {
    fs.rmSync(venv, { recursive: true, force: true });
    fail(`installing code-review-graph ${VERSION} failed:\n${r.stderr}`);
  }
  return venv;
}

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(3, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return;
  }
  const top = run("git", ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) fail("not in a git repository");
  const root = top.stdout.trim();
  const cache = cacheRoot(process.env, os.homedir());
  const venv = ensureTool(cache);
  const data = dataDir(root, cache);
  const env = { ...process.env, CRG_DATA_DIR: data };
  const tool = (...args) => run(...toolCommand(venv, process.platform, args), { cwd: root, env });
  const json = (...args) => {
    const r = tool(...args);
    try {
      return JSON.parse(r.stdout);
    } catch {
      fail(`code-review-graph ${args[0]} printed no JSON:\n${(r.stderr || r.stdout).trim().split("\n").slice(-5).join("\n")}`);
    }
  };
  const refresh = () => {
    const first = !fs.existsSync(path.join(data, "graph.db"));
    const r = tool(first ? "build" : "update");
    const line = buildLine(`${r.stdout}\n${r.stderr}`);
    if (!line) fail(`the graph build failed:\n${(r.stderr || r.stdout).trim().split("\n").slice(-5).join("\n")}`);
    return line;
  };
  const print = (lines) => console.log(lines.join("\n"));

  if (command === "version") {
    console.log(tool("--version").stdout.trim());
  } else if (command === "build") {
    console.log(refresh());
  } else if (PATTERNS[command]) {
    if (!rest[0]) fail(`usage: cg ${command} <name | file::name>`);
    refresh();
    let answer = json("query", PATTERNS[command], toTarget(rest[0], root));
    const sole = soleDefinition(answer, rest[0]);
    if (sole) answer = json("query", PATTERNS[command], sole);
    print(formatQuery(answer, root, command, rest[0]));
  } else if (command === "skeleton") {
    if (!rest[0]) fail("usage: cg skeleton <file>");
    refresh();
    print(formatSkeleton(json("query", "file_summary", rel(path.resolve(rest[0]), root))));
  } else if (command === "search") {
    if (!rest.length) fail("usage: cg search <words>");
    refresh();
    print(formatSearch(json("search", rest.join(" "), "--limit", "20"), root));
  } else if (command === "impact") {
    const i = rest.indexOf("--base");
    let base = i >= 0 ? rest[i + 1] : null;
    if (!base) {
      const head = run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: root });
      base = head.status === 0 ? head.stdout.trim() : "origin/main";
    }
    refresh();
    print(formatImpact(json("impact", "--base", base, "--max-results", "60"), json("detect-changes", "--base", base), root));
  } else {
    fail(`unknown command ${command}; run it with no arguments for the list`);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  VERSION,
  EXTRA_EXTENSIONS,
  findPython,
  toolCommand,
  cacheRoot,
  dataDir,
  venvDir,
  venvExe,
  rel,
  toTarget,
  buildLine,
  soleDefinition,
  formatQuery,
  formatSkeleton,
  formatSearch,
  formatImpact,
};
