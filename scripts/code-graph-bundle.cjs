#!/usr/bin/env node
// code-graph-bundle: builds the code-review-graph bundle that cloud sessions download instead of
// installing it with pip (.github/workflows/code-graph-bundle.yml). Linux x86_64 only; local
// sessions keep the pip install in agent-skills/code-graph/scripts/cg.cjs.
//
//   lock               resolves code-review-graph==VERSION (cg.cjs) and writes the packages cg
//                      imports, with their hashes, to scripts/code-graph-bundle/requirements.txt
//   check-lock         fails unless the lock pins VERSION
//   uv-version         the uv the build pins
//   next-tag [--force] reads releases as JSON lines {tag, body} and prints code-graph-<VERSION>-<n>,
//                      or nothing when this build (lock, Python, uv) is already released
//   build DIR          DIR/crg: the portable Python with the locked packages, trimmed
//   full DIR           DIR/crg: the same Python with every package, for verify
//   licenses DIR       checks every license in DIR/crg against the allowlist and writes
//                      DIR/crg/THIRD_PARTY_LICENSES
//   verify DIR FULL    every cg command gives the same output with DIR/crg and FULL/crg
//   pack DIR OUT       OUT/crg-linux-x86_64.tar.gz, OUT/SHA256SUMS and OUT/notes.md
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LOCK = path.join(__dirname, "code-graph-bundle", "requirements.txt");
const CG = path.join(ROOT, "agent-skills", "code-graph", "scripts", "cg.cjs");
const ASSET = "crg-linux-x86_64.tar.gz";

// The portable Python (python-build-standalone, as uv installs it) and the uv that installs it.
// A change to either is a new build of the same code-review-graph version.
const PYTHON = "3.13.14";
const UV = "0.11.32";

// What cg imports from code-review-graph (measured 2026-10-16 on 2.3.9: every cg command on
// stella-rain/core and stella-rain/app). code-review-graph also requires fastmcp, mcp and anyio
// for its MCP server, which cg never starts; verify catches a release that starts needing more.
const KEEP = [
  "code-review-graph",
  "networkx",
  "pyyaml",
  "tree-sitter",
  "tree-sitter-c-sharp",
  "tree-sitter-embedded-template",
  "tree-sitter-language-pack",
  "tree-sitter-yaml",
];

// ---- the lock --------------------------------------------------------------------------------

const norm = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");

function filterLock(text, keep = KEEP) {
  const blocks = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const pin = /^([A-Za-z0-9][A-Za-z0-9._-]*)==/.exec(line);
    if (pin) {
      current = norm(pin[1]);
      blocks.set(current, [line]);
    } else if (current && /^\s+--hash=/.test(line)) {
      blocks.get(current).push(line);
    } else if (!/^\s*#/.test(line) && line.trim()) {
      current = null;
    }
  }
  const missing = keep.filter((k) => !blocks.has(norm(k)));
  if (missing.length) throw new Error(`the resolution has no ${missing.join(", ")}`);
  const version = /==([^\s\\]+)/.exec(blocks.get("code-review-graph")[0])[1];
  const header = [
    `# The packages the code-graph bundle installs: what cg imports from code-review-graph ${version},`,
    "# with their hashes, installed with --no-deps --require-hashes (scripts/code-graph-bundle.cjs).",
    "# Regenerate after changing VERSION in agent-skills/code-graph/scripts/cg.cjs:",
    "#   node scripts/code-graph-bundle.cjs lock",
  ];
  const kept = [...blocks.keys()].filter((k) => keep.some((n) => norm(n) === k)).sort();
  return [...header, ...kept.flatMap((k) => blocks.get(k))].join("\n") + "\n";
}

function lockVersion(text) {
  const m = /^code-review-graph==([^\s\\]+)/m.exec(text);
  return m ? m[1] : null;
}

function checkLock(lock, version) {
  const pinned = lockVersion(lock);
  if (pinned !== version) {
    throw new Error(`the lock pins code-review-graph ${pinned}, cg.cjs VERSION is ${version}: run node scripts/code-graph-bundle.cjs lock`);
  }
}

function readLock() {
  return fs.readFileSync(LOCK, "utf8");
}

// ---- the release tag -------------------------------------------------------------------------

function buildKey(lock, python, uv) {
  return crypto.createHash("sha256").update(`${lock}\npython ${python}\nuv ${uv}\n`).digest("hex");
}

function nextTag(version, key, releases, force = false) {
  const re = new RegExp(`^code-graph-${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  const mine = releases.map((r) => [r, re.exec(r.tag)]).filter(([, m]) => m);
  if (!force && mine.some(([r]) => (r.body || "").includes(`bundle key: ${key}`))) return null;
  const n = Math.max(0, ...mine.map(([, m]) => Number(m[1]))) + 1;
  return `code-graph-${version}-${n}`;
}

// ---- licenses --------------------------------------------------------------------------------

const ALLOWED = new Set([
  "MIT", "MIT-0", "BSD", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "ISC", "Zlib",
  "PSF-2.0", "Python-2.0", "MPL-2.0", "Unlicense", "CC0-1.0", "WTFPL",
]);
const EXCEPTIONS = new Set(["LLVM-exception"]);

function classifyLicense(text) {
  const spdx = /SPDX-License-Identifier:\s*([^\n]+)/.exec(text);
  if (spdx) return spdx[1].trim();
  const s = text.replace(/\s+/g, " ").toLowerCase();
  const rules = [
    ["MPL-2.0", /mozilla public license,? version 2\.0/],
    ["PSF-2.0", /python software foundation license/],
    ["AGPL-3.0", /gnu affero general public license/],
    ["LGPL", /gnu (lesser|library) general public license/],
    ["GPL", /gnu general public license/],
    ["WTFPL", /do what the fuck you want/],
    ["Apache-2.0", /apache license,? version 2\.0/],
    ["Unlicense", /free and unencumbered software/],
    ["CC0-1.0", /cc0 1\.0 universal|creative commons legal code cc0/],
    ["MIT", /permission is hereby granted, free of charge/],
    ["ISC", /permission to use, copy, modify, and\/or distribute/],
    ["BSD-3-Clause", /redistribution and use in source and binary forms.*(neither the name|names of its contributors)/],
    ["BSD-2-Clause", /redistribution and use in source and binary forms/],
  ];
  for (const [id, re] of rules) if (re.test(s)) return id;
  return "UNKNOWN";
}

function licenseAllowed(expr) {
  const e = (expr || "").replace(/[()]/g, " ").trim();
  if (!e) return false;
  return e.split(/\s+OR\s+/).some((branch) =>
    branch.split(/\s+AND\s+/).every((term) => {
      const [id, exception] = term.trim().split(/\s+WITH\s+/);
      return ALLOWED.has(id) && (!exception || EXCEPTIONS.has(exception));
    })
  );
}

const CLASSIFIERS = {
  "MIT License": "MIT",
  "MIT No Attribution License (MIT-0)": "MIT-0",
  "Apache Software License": "Apache-2.0",
  "BSD License": "BSD",
  "ISC License (ISCL)": "ISC",
  "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
  "Python Software Foundation License": "PSF-2.0",
  "The Unlicense (Unlicense)": "Unlicense",
};

function packageLicense(metadata) {
  const headers = metadata.split(/\r?\n\r?\n/)[0].split(/\r?\n/);
  const field = (name) => headers.filter((l) => l.startsWith(`${name}: `)).map((l) => l.slice(name.length + 2).trim());
  const expression = field("License-Expression")[0];
  if (expression) return expression;
  const classified = field("Classifier")
    .filter((c) => c.startsWith("License :: "))
    .map((c) => {
      const last = c.split(" :: ").pop();
      if (CLASSIFIERS[last]) return CLASSIFIERS[last];
      return /affero/i.test(last) ? "AGPL-3.0" : /lesser|library/i.test(last) ? "LGPL" : /general public/i.test(last) ? "GPL" : "UNKNOWN";
    });
  if (classified.length) return [...new Set(classified)].join(" OR ");
  const license = (field("License")[0] || "").split("\n")[0].trim();
  if (/^[A-Za-z0-9.+-]+$/.test(license)) return license;
  return license ? classifyLicense(license) : "UNKNOWN";
}

// ---- the trim --------------------------------------------------------------------------------

// p is relative to the bundle root, with "/" and a trailing "/" on folders.
function trimmed(p, keepGrammars) {
  const binding = /^lib\/python3\.\d+\/site-packages\/tree_sitter_language_pack\/bindings\/([^/]+?)\.(abi3\.so|so|pyd)$/.exec(p);
  if (binding) return !keepGrammars.includes(binding[1]);
  return [
    /^lib\/python3\.\d+\/(test|idlelib|tkinter|turtledemo|ensurepip|lib2to3)\//,
    /^lib\/python3\.\d+\/lib-dynload\/_(dbm|gdbm|tkinter)[.]/, // _dbm holds Berkeley DB 6 (AGPL-3.0)
    /^lib\/python3\.\d+\/site-packages\/pip(\/|-[^/]*\.dist-info\/)/,
    /(^|\/)__pycache__\//,
    /\.a$/,
    /^lib\/(libtcl|libtk)[^/]*$/,
    /^lib\/(tcl|tk|itcl|thread|tdbc)[\d.]*[^/]*\//,
    /^lib\/pkgconfig\//,
    /^(include|share)\//,
    /^bin\/(pip|idle|pydoc|2to3)[^/]*$/,
    /^bin\/python[\d.]*-config$/,
  ].some((re) => re.test(p));
}

// ---- running things --------------------------------------------------------------------------

const QUIET = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, env: QUIET, ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  return r;
}

function must(cmd, args, opts = {}) {
  const r = run(cmd, args, opts);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${(r.stderr || r.stdout).trim().split("\n").slice(-10).join("\n")}`);
  return r.stdout;
}

function cgVersion() {
  return require(CG).VERSION;
}

function python(dir) {
  return path.join(dir, "crg", "bin", "python3");
}

function sitePackages(dir) {
  return path.join(dir, "crg", "lib", `python${PYTHON.split(".").slice(0, 2).join(".")}`, "site-packages");
}

function needUv() {
  const v = run("uv", ["--version"]);
  if (v.status !== 0) throw new Error("uv is not on PATH");
  const have = v.stdout.split(/\s+/)[1];
  if (have !== UV) throw new Error(`the build pins uv ${UV}, this is uv ${have}`);
}

function needPlatform() {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("the bundle is built on Linux x86_64 only");
}

// The portable Python, copied out of uv's install folder into DIR/crg.
function freshPython(dir) {
  const store = path.join(dir, ".python");
  fs.rmSync(path.join(dir, "crg"), { recursive: true, force: true });
  must("uv", ["python", "install", "-q", "--no-bin", "--install-dir", store, PYTHON]);
  const name = fs.readdirSync(store).find((n) => n.startsWith(`cpython-${PYTHON}-linux-x86_64-gnu`));
  if (!name) throw new Error(`uv installed no cpython-${PYTHON} into ${store}`);
  fs.cpSync(path.join(store, name), path.join(dir, "crg"), { recursive: true, verbatimSymlinks: true });
  fs.rmSync(store, { recursive: true, force: true });
}

function mappedGrammars(dir) {
  const out = must(python(dir), ["-I", "-c", "import json, code_review_graph.parser as p; print(json.dumps(sorted(set(p.EXTENSION_TO_LANGUAGE.values()))))"]);
  return JSON.parse(out);
}

function walkTrim(root, keep, rel = "") {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const p = rel + e.name + (e.isDirectory() ? "/" : "");
    if (trimmed(p, keep)) fs.rmSync(path.join(root, p), { recursive: true, force: true });
    else if (e.isDirectory()) walkTrim(root, keep, p);
  }
}

function manifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "crg", "BUNDLE.json"), "utf8"));
}

function build(dir) {
  needPlatform();
  needUv();
  const lock = readLock();
  checkLock(lock, cgVersion());
  freshPython(dir);
  must("uv", ["pip", "install", "-q", "--python", python(dir), "--break-system-packages", "--no-deps", "--require-hashes", "-r", LOCK]);
  // The installed script names the build folder in its first line; this one runs from anywhere.
  const script = path.join(dir, "crg", "bin", "code-review-graph");
  fs.writeFileSync(script, '#!/bin/sh\nexec "$(dirname "$0")/python3" -m code_review_graph "$@"\n', { mode: 0o755 });
  const grammars = mappedGrammars(dir);
  walkTrim(path.join(dir, "crg"), grammars);
  const packages = KEEP.map((n) => must(python(dir), ["-I", "-c", `import importlib.metadata as m; print(m.version(${JSON.stringify(n)}))`]).trim()).map((v, i) => `${KEEP[i]}==${v}`);
  const head = run("git", ["-C", ROOT, "rev-parse", "HEAD"]);
  const info = {
    code_review_graph: cgVersion(),
    python: PYTHON,
    uv: UV,
    key: buildKey(lock, PYTHON, UV),
    commit: head.status === 0 ? head.stdout.trim() : null,
    packages,
    grammars,
  };
  fs.writeFileSync(path.join(dir, "crg", "BUNDLE.json"), JSON.stringify(info, null, 2) + "\n");
  console.log(`built ${path.join(dir, "crg")}: code-review-graph ${info.code_review_graph}, Python ${PYTHON}, ${packages.length} packages`);
}

function full(dir) {
  needPlatform();
  needUv();
  freshPython(dir);
  must("uv", ["pip", "install", "-q", "--python", python(dir), "--break-system-packages", `code-review-graph==${cgVersion()}`]);
  console.log(`built ${path.join(dir, "crg")}: code-review-graph ${cgVersion()} with every dependency`);
}

// ---- licenses: the check -----------------------------------------------------------------------

function grammarSources(packVersion) {
  const meta = JSON.parse(must("curl", ["-sSfL", `https://pypi.org/pypi/tree-sitter-language-pack/${packVersion}/json`]));
  const sdist = meta.urls.find((u) => u.packagetype === "sdist");
  if (!sdist) throw new Error(`tree-sitter-language-pack ${packVersion} has no source release`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crg-pack-"));
  const file = path.join(tmp, "pack.tar.gz");
  must("curl", ["-sSfL", "-o", file, sdist.url]);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (digest !== sdist.digests.sha256) throw new Error("the language pack's source release does not match its PyPI hash");
  const json = must("tar", ["-xzf", file, "-O", "--wildcards", "*/sources/language_definitions.json"]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return JSON.parse(json);
}

function grammarLicense(name, source) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `crg-${name}-`));
  try {
    must("git", ["init", "-q", tmp]);
    must("git", ["-C", tmp, "fetch", "-q", "--depth", "1", "--filter=blob:none", source.repo, source.rev || "HEAD"]);
    const files = must("git", ["-C", tmp, "ls-tree", "--name-only", "FETCH_HEAD"]).split("\n");
    const file = files.find((f) => /^(licen[cs]e|copying|unlicense)(\.|$)/i.test(f));
    if (!file) throw new Error(`grammar ${name} (${source.repo}) has no license file at ${source.rev}`);
    return { file, text: must("git", ["-C", tmp, "show", `FETCH_HEAD:${file}`]) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function licenses(dir) {
  const site = sitePackages(dir);
  const crg = path.join(dir, "crg");
  const problems = [];
  const sections = [];
  const rows = [];

  const runtime = run(python(dir), ["-I", "-c", [
    "import importlib.util, readline",
    "print(importlib.util.find_spec('_dbm') is None, getattr(readline, 'backend', '?'))",
  ].join("\n")]);
  if (runtime.stdout.trim() !== "True editline") problems.push(`the runtime must have no _dbm and readline on editline; it reports: ${runtime.stdout.trim() || runtime.stderr.trim()}`);
  const pyLicense = path.join(crg, "lib", `python${PYTHON.split(".").slice(0, 2).join(".")}`, "LICENSE.txt");
  sections.push([`Python ${PYTHON} (python-build-standalone)`, fs.readFileSync(pyLicense, "utf8")]);
  rows.push(["Python", PYTHON, "PSF-2.0"]);

  let packVersion = null;
  for (const info of fs.readdirSync(site).filter((n) => n.endsWith(".dist-info")).sort()) {
    const meta = fs.readFileSync(path.join(site, info, "METADATA"), "utf8");
    const name = /^Name: (.+)$/m.exec(meta)[1].trim();
    const version = /^Version: (.+)$/m.exec(meta)[1].trim();
    if (norm(name) === "tree-sitter-language-pack") packVersion = version;
    const license = packageLicense(meta);
    if (!licenseAllowed(license)) problems.push(`${name} ${version}: license ${license} is not on the allowlist`);
    const texts = [];
    (function collect(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) collect(f);
        else if (/^(licen[cs]e|copying|notice|authors)/i.test(e.name) || path.relative(path.join(site, info), f).startsWith("licenses")) {
          texts.push([path.relative(site, f), fs.readFileSync(f, "utf8")]);
        }
      }
    })(path.join(site, info));
    if (!texts.length) problems.push(`${name} ${version} ships no license file`);
    for (const [f, t] of texts) sections.push([`${name} ${version} (${license}): ${f}`, t]);
    rows.push([name, version, license]);
  }
  if (!packVersion) problems.push("tree-sitter-language-pack is not installed");

  const bindings = path.join(site, "tree_sitter_language_pack", "bindings");
  const shipped = fs.readdirSync(bindings).map((f) => /^(.+?)\.(abi3\.so|so|pyd)$/.exec(f)).filter(Boolean).map((m) => m[1]).sort();
  const sources = packVersion ? grammarSources(packVersion) : {};
  const grammars = [];
  for (const name of shipped) {
    const source = sources[name];
    if (!source) {
      problems.push(`grammar ${name} is not in the language pack's sources`);
      continue;
    }
    try {
      const { file, text } = grammarLicense(name, source);
      const license = classifyLicense(text);
      if (!licenseAllowed(license)) problems.push(`grammar ${name} (${source.repo}): license ${license} is not on the allowlist`);
      sections.push([`grammar ${name} (${license}): ${source.repo} at ${source.rev}, ${file}`, text]);
      grammars.push([name, license]);
    } catch (e) {
      problems.push(e.message);
    }
  }

  if (problems.length) throw new Error(`license check failed:\n- ${problems.join("\n- ")}`);
  const body = sections.map(([title, text]) => `==== ${title}\n\n${text.trimEnd()}\n`).join("\n");
  fs.writeFileSync(path.join(crg, "THIRD_PARTY_LICENSES"), `Third-party licenses in this bundle.\n\n${body}`);
  fs.writeFileSync(path.join(dir, "licenses.json"), JSON.stringify({ packages: rows, grammars }, null, 2) + "\n");
  console.log(`licenses: ${rows.length} components and ${grammars.length} grammars, all on the allowlist`);
  for (const [n, v, l] of rows) console.log(`  ${n} ${v}: ${l}`);
  console.log(`  grammars: ${grammars.map(([n, l]) => `${n} (${l})`).join(", ")}`);
}

// ---- verify: the bundle answers like a full install ----------------------------------------------

const AVAILABLE = [
  "import json, code_review_graph.parser as p",
  "langs = sorted(set(p.EXTENSION_TO_LANGUAGE.values()))",
  "print(json.dumps({l: p._load_tree_sitter_parser(l) is not None for l in langs}))",
].join("\n");

const COMMANDS = [
  ["build"],
  ["search", "release", "tag"],
  ["callers", "nextTag"],
  ["callers", "setStamp"],
  ["tests", "nextTag"],
  ["skeleton", "scripts/release.cjs"],
  ["skeleton", "hooks/global-sync.cjs"],
  ["impact", "--base", "HEAD"],
  ["version"],
];

function cgOutputs(dir, repo, version) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "crg-cache-"));
  fs.mkdirSync(path.join(cache, "code-review-graph"));
  fs.symlinkSync(path.join(path.resolve(dir), "crg"), path.join(cache, "code-review-graph", `venv-${version}`));
  const env = { ...QUIET, XDG_CACHE_HOME: cache };
  const out = COMMANDS.map((args) => {
    const r = run(process.execPath, [CG, ...args], { cwd: repo, env });
    return `$ cg ${args.join(" ")} (exit ${r.status})\n${r.stdout}${r.stderr}`;
  });
  fs.rmSync(cache, { recursive: true, force: true });
  return out;
}

function verify(dir, fullDir) {
  const version = manifest(dir).code_review_graph;
  const a = JSON.parse(must(python(dir), ["-I", "-c", AVAILABLE]));
  const b = JSON.parse(must(python(fullDir), ["-I", "-c", AVAILABLE]));
  const differ = Object.keys(b).filter((l) => a[l] !== b[l]);
  if (differ.length) throw new Error(`grammars load differently in the bundle: ${differ.join(", ")}`);

  // A throwaway clone of this repository with one changed function, so impact has a change.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "crg-repo-"));
  must("git", ["clone", "-q", "--no-local", ROOT, repo]);
  const file = path.join(repo, "scripts", "release.cjs");
  const src = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, src.replace("function setStamp(text, tag) {\n", "function setStamp(text, tag) {\n  const probe = 1;\n"));
  const mine = cgOutputs(dir, repo, version);
  const theirs = cgOutputs(fullDir, repo, version);
  fs.rmSync(repo, { recursive: true, force: true });
  const bad = mine.map((o, i) => [o, theirs[i]]).filter(([x, y]) => x !== y);
  if (bad.length) throw new Error(`the bundle answers differently from a full install:\n${bad.map(([x, y]) => `--- bundle\n${x}\n--- full\n${y}`).join("\n")}`);
  if (!/^Full build: \d+ files/m.test(mine[0])) throw new Error(`cg build printed no build line:\n${mine[0]}`);
  if (mine.some((o) => !/\(exit 0\)/.test(o.split("\n")[0]))) throw new Error(`a cg command failed:\n${mine.join("\n")}`);
  console.log(`verify: ${Object.keys(a).length} languages load as in a full install; ${COMMANDS.length} cg commands answer the same`);
  for (const o of mine) console.log(`  ${o.split("\n")[0]}: ${o.split("\n")[1] || ""}`);
}

// ---- pack ----------------------------------------------------------------------------------------

function pack(dir, out) {
  const info = manifest(dir);
  walkTrim(path.join(dir, "crg"), info.grammars); // drops any __pycache__ a check left behind
  fs.mkdirSync(out, { recursive: true });
  const asset = path.join(out, ASSET);
  const tar = run("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-C", dir, "-cf", "-", "crg"], { encoding: "buffer" });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
  const gz = spawnSync("gzip", ["-n", "-9"], { input: tar.stdout, maxBuffer: 1 << 30 });
  if (gz.status !== 0) throw new Error(`gzip failed: ${gz.stderr}`);
  fs.writeFileSync(asset, gz.stdout);
  const digest = crypto.createHash("sha256").update(gz.stdout).digest("hex");
  fs.writeFileSync(path.join(out, "SHA256SUMS"), `${digest}  ${ASSET}\n`);
  const lic = JSON.parse(fs.readFileSync(path.join(dir, "licenses.json"), "utf8"));
  const notes = [
    `code-review-graph ${info.code_review_graph} for cloud sessions of the code-graph skill (Linux x86_64),`,
    `built from ${info.commit || "an unknown commit"} by .github/workflows/code-graph-bundle.yml.`,
    "",
    `- Python ${info.python} (python-build-standalone, installed by uv ${info.uv}), trimmed; no \`_dbm\``,
    `- Packages (only what cg imports): ${info.packages.map((p) => `\`${p}\``).join(", ")}`,
    `- Grammars: ${lic.grammars.length} of the language pack's, the languages code-review-graph maps`,
    `- Licenses: ${[...new Set([...lic.packages.map((r) => r[2]), ...lic.grammars.map((g) => g[1])])].sort().join(", ")}; texts in \`crg/THIRD_PARTY_LICENSES\``,
    `- \`${ASSET}\`: ${(gz.stdout.length / 1e6).toFixed(1)} MB, sha256 \`${digest}\``,
    "",
    `bundle key: ${info.key}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(out, "notes.md"), notes);
  console.log(`packed ${asset}: ${(gz.stdout.length / 1e6).toFixed(1)} MB, sha256 ${digest}`);
}

// ---- commands ------------------------------------------------------------------------------------

function lockCommand() {
  needUv();
  const compiled = must("uv", [
    "pip", "compile", "-q", "-", "--generate-hashes", "--no-header", "--no-annotate",
    "--python-version", PYTHON.split(".").slice(0, 2).join("."), "--python-platform", "x86_64-manylinux_2_28",
  ], { input: `code-review-graph==${cgVersion()}\n` });
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, filterLock(compiled));
  console.log(`wrote ${path.relative(ROOT, LOCK)}: code-review-graph ${cgVersion()}, ${KEEP.length} packages`);
}

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "lock") lockCommand();
    else if (cmd === "check-lock") checkLock(readLock(), cgVersion());
    else if (cmd === "uv-version") console.log(UV);
    else if (cmd === "next-tag") {
      const releases = fs.readFileSync(0, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
      console.log(nextTag(cgVersion(), buildKey(readLock(), PYTHON, UV), releases, rest.includes("--force")) || "");
    } else if (cmd === "build" && rest[0]) build(rest[0]);
    else if (cmd === "full" && rest[0]) full(rest[0]);
    else if (cmd === "licenses" && rest[0]) licenses(rest[0]);
    else if (cmd === "verify" && rest[1]) verify(rest[0], rest[1]);
    else if (cmd === "pack" && rest[1]) pack(rest[0], rest[1]);
    else throw new Error("usage: code-graph-bundle.cjs lock | check-lock | uv-version | next-tag [--force] | build DIR | full DIR | licenses DIR | verify DIR FULL | pack DIR OUT");
  } catch (e) {
    console.error(`code-graph-bundle: ${e.message}`);
    process.exit(1);
  }
}

module.exports = {
  KEEP,
  PYTHON,
  UV,
  filterLock,
  lockVersion,
  checkLock,
  readLock,
  buildKey,
  nextTag,
  classifyLicense,
  licenseAllowed,
  packageLicense,
  trimmed,
};
