// Run: node --test scripts/code-graph.test.cjs
// The code-graph skill's wrapper (agent-skills/code-graph/scripts/cg.cjs) turns code-review-graph's
// JSON into short lines. The fixtures below keep the shapes code-review-graph 2.3.9 printed on
// stella-rain/app and stella-rain/core (2026-10-16), with the paths replaced.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const cg = require("../agent-skills/code-graph/scripts/cg.cjs");

const ROOT = "C:/work/game";

function fn(file, name, line, extra = {}) {
  return {
    kind: "Function",
    name,
    qualified_name: `${ROOT}/${file}::${extra.parent ? extra.parent + "." : ""}${name}`,
    file_path: `${ROOT}/${file}`,
    line_start: line,
    line_end: line + 5,
    parent_name: extra.parent || null,
    is_test: !!extra.test,
    ...(extra.call ? { call_site: { line: extra.call } } : {}),
    ...(extra.unresolved ? { target_resolution: "unresolved" } : {}),
  };
}

// ---- where the graph and the tool live ----------------------------------------------------

test("the graph of a repository lives under the cache, one folder per repository path", () => {
  const cache = cg.cacheRoot({}, "/home/kade");
  assert.strictEqual(cache, path.join("/home/kade", ".cache", "code-review-graph"));
  assert.strictEqual(cg.cacheRoot({ XDG_CACHE_HOME: "/tmp/c" }, "/home/kade"), path.join("/tmp/c", "code-review-graph"));
  assert.strictEqual(cg.dataDir("/home/kade/src/game", cache), path.join(cache, "graphs", "_home_kade_src_game"));
  // No ':' or '\' survives on Windows: the folder name is one plain segment.
  assert.strictEqual(path.basename(cg.dataDir("C:/Users/kade/game", cache)), "C__Users_kade_game");
  assert.strictEqual(path.basename(cg.dataDir("C:\\Users\\kade\\game", cache)), "C__Users_kade_game");
});

test("the pinned version gets its own virtual environment, with the platform's script path", () => {
  const venv = cg.venvDir("/c");
  assert.strictEqual(venv, path.join("/c", `venv-${cg.VERSION}`));
  assert.strictEqual(cg.venvExe(venv, "win32"), path.join(venv, "Scripts", "code-review-graph.exe"));
  assert.strictEqual(cg.venvExe(venv, "darwin"), path.join(venv, "bin", "code-review-graph"));
});

test("a target is a bare name, or a repository-relative path and a name", () => {
  assert.strictEqual(cg.toTarget("resume", ROOT), "resume");
  assert.strictEqual(cg.toTarget("godot/play/play.gd::resume", ROOT), `${ROOT}/godot/play/play.gd::resume`);
  assert.strictEqual(cg.toTarget("src\\engine.rs::Engine.step", ROOT), `${ROOT}/src/engine.rs::Engine.step`);
  assert.strictEqual(cg.toTarget(`${ROOT}/src/engine.rs::Engine.step`, ROOT), `${ROOT}/src/engine.rs::Engine.step`);
});

test("the build prints only its summary line", () => {
  const out = "INFO: FTS index rebuilt: 582 rows indexed\nFull build: 45 files, 582 nodes, 7093 edges (postprocess=full)\n";
  assert.strictEqual(cg.buildLine(out), "Full build: 45 files, 582 nodes, 7093 edges (postprocess=full)");
  assert.strictEqual(cg.buildLine("INFO: x\nIncremental: 0 files updated, 0 nodes, 0 edges (postprocess=full)"), "Incremental: 0 files updated, 0 nodes, 0 edges (postprocess=full)");
  assert.strictEqual(cg.buildLine("Traceback ...\nValueError: no"), null);
});

// ---- queries ------------------------------------------------------------------------------

test("callers print one line per call site, repository-relative, sorted, tests marked", () => {
  const json = {
    status: "ok",
    target: `${ROOT}/godot/play/play.gd::_show_offer`,
    results: [
      fn("godot/play/play.gd", "step_tick", 476, { call: 481 }),
      fn("godot/play/play.gd", "resume", 170, { call: 174 }),
      fn("godot/tests/run.gd", "_test_offers", 833, { call: 938, test: true }),
    ],
  };
  assert.deepStrictEqual(cg.formatQuery(json, ROOT, "callers"), [
    "godot/play/play.gd::_show_offer: 3 callers",
    "  godot/play/play.gd:174  resume",
    "  godot/play/play.gd:481  step_tick",
    "  godot/tests/run.gd:938  _test_offers  [test]",
  ]);
});

test("callers matched by name only are marked, with the shared-name warning and a grep to confirm", () => {
  const json = {
    status: "ok",
    target: `${ROOT}/src/engine.rs::Engine.state_hash`,
    results: [
      fn("src/replay.rs", "verify_inner", 347, { call: 360 }),
      fn("tests/spike.rs", "run", 28, { call: 33, test: true, unresolved: true }),
    ],
  };
  const lines = cg.formatQuery(json, ROOT, "callers");
  assert.deepStrictEqual(lines.slice(0, 3), [
    "src/engine.rs::Engine.state_hash: 2 callers",
    "  src/replay.rs:360  verify_inner",
    "  tests/spike.rs:33  run  [test] ?",
  ]);
  assert.match(lines[3], /^\? = matched by name only \(1 of 2\)/);
  assert.match(lines[3], /another function named state_hash/);
  assert.ok(lines.includes('  confirm with: git grep -n "state_hash("'));
});

test("an ambiguous name lists its definitions and how to pick one", () => {
  const json = {
    status: "ambiguous",
    candidate_count: 3,
    candidates: [
      fn("src/spike.rs", "step", 57, { parent: "Spike" }),
      fn("src/rules.rs", "step_order", 222),
      fn("src/engine.rs", "step", 89, { parent: "Engine" }),
    ],
  };
  // code-review-graph also offers near names (step_order); only the exact ones are definitions.
  assert.deepStrictEqual(cg.formatQuery(json, ROOT, "callers", "step"), [
    "step has 2 definitions; ask again with one of:",
    "  src/engine.rs::Engine.step  (line 89)",
    "  src/spike.rs::Spike.step  (line 57)",
  ]);
  // With no exact match, every candidate is shown.
  const near = { status: "ambiguous", candidates: [fn("a.rs", "parse", 4), fn("b.rs", "choice_index", 9)] };
  assert.deepStrictEqual(cg.formatQuery(near, ROOT, "callers", "choose"), [
    "choose has no exact match; ask again with one of:",
    "  a.rs::parse  (line 4)",
    "  b.rs::choice_index  (line 9)",
  ]);
});

test("callees, tests and an empty answer read the same way", () => {
  const callees = { status: "ok", target: `${ROOT}/a.rs::f`, results: [fn("b.rs", "g", 10)] };
  assert.deepStrictEqual(cg.formatQuery(callees, ROOT, "callees"), ["a.rs::f: 1 callee", "  b.rs:10  g"]);
  const tests = { status: "ok", target: `${ROOT}/a.rs::f`, results: [fn("a.rs", "f_works", 40, { test: true })] };
  assert.deepStrictEqual(cg.formatQuery(tests, ROOT, "tests"), ["a.rs::f: 1 test", "  a.rs:40  f_works  [test]"]);
  const none = { status: "ok", target: `${ROOT}/a.rs::f`, results: [] };
  assert.deepStrictEqual(cg.formatQuery(none, ROOT, "callers"), [
    "a.rs::f: 0 callers",
    '  none in the graph; calls across languages (GDScript to Rust) and through a variable are not tracked: git grep -n "f("',
  ]);
});

test("anything else code-review-graph says is passed on as its summary", () => {
  assert.deepStrictEqual(cg.formatQuery({ status: "not_found", summary: "No node matches 'zzz'." }, ROOT, "callers"), ["No node matches 'zzz'."]);
});

test("a skeleton lists a file's definitions in order, without the file node", () => {
  const json = {
    status: "ok",
    results: [
      { kind: "File", name: `${ROOT}/godot/shell/shell.gd`, line_start: 1, line_end: 200, parent_name: null },
      fn("godot/shell/shell.gd", "show_title", 95),
      { kind: "Class", name: "Shell", line_start: 1, line_end: 200, parent_name: null },
      fn("godot/shell/shell.gd", "save", 120, { parent: "Store" }),
    ],
  };
  assert.deepStrictEqual(cg.formatSkeleton(json), [
    "L1-L200  Class  Shell",
    "L95-L100  Function  show_title",
    "L120-L125  Function  Store.save",
  ]);
});

test("search prints its hits in the order code-review-graph ranked them", () => {
  const json = { status: "ok", results: [fn("src/rules_v0/mod.rs", "state_hash", 591), fn("src/engine.rs", "state_hash", 114, { parent: "Engine" })] };
  assert.deepStrictEqual(cg.formatSearch(json, ROOT), [
    "src/rules_v0/mod.rs:591  Function  state_hash",
    "src/engine.rs:114  Function  Engine.state_hash",
  ]);
});

test("impact prints both summaries and the reached code outside the changed files", () => {
  const impact = {
    status: "ok",
    summary: "Blast radius for 1 changed file(s):\n  - 54 nodes impacted (within 2 hops)",
    changed_files: ["src/engine.rs"],
    impacted_nodes: [
      fn("src/engine.rs", "tick", 200),
      fn("src/replay.rs", "verify_inner", 347),
      { kind: "File", name: `${ROOT}/src/replay.rs`, file_path: `${ROOT}/src/replay.rs`, line_start: 1 },
    ],
  };
  const changes = { summary: "Analyzed 1 changed file(s):\n  - Overall risk score: 0.85" };
  assert.deepStrictEqual(cg.formatImpact(impact, changes, ROOT), [
    "Blast radius for 1 changed file(s):",
    "  - 54 nodes impacted (within 2 hops)",
    "Analyzed 1 changed file(s):",
    "  - Overall risk score: 0.85",
    "Reached outside the changed files:",
    "  src/replay.rs:347  verify_inner",
  ]);
});
