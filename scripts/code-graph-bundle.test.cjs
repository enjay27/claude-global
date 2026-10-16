// Run: node --test scripts/code-graph-bundle.test.cjs
// The pure parts of the code-graph bundle build (scripts/code-graph-bundle.cjs): the lock, the
// release tag, the license rules and what the trim removes. The build itself runs in
// .github/workflows/code-graph-bundle.yml, which also compares the bundle with a full install.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const b = require("./code-graph-bundle.cjs");
const cg = require("../agent-skills/code-graph/scripts/cg.cjs");

// ---- the lock --------------------------------------------------------------------------------

// The shape `uv pip compile --generate-hashes --no-header` prints.
const COMPILED = [
  "anyio==4.15.1 \\",
  "    --hash=sha256:aaa \\",
  "    --hash=sha256:bbb",
  "    # via",
  "    #   fastmcp",
  "    #   mcp",
  "code-review-graph==2.3.9 \\",
  "    --hash=sha256:ccc",
  "    # via -r in.txt",
  "fastmcp==3.4.8 \\",
  "    --hash=sha256:ddd",
  "networkx==3.7 \\",
  "    --hash=sha256:eee",
  "    # via code-review-graph",
  "pyyaml==6.0.3 \\",
  "    --hash=sha256:fff",
  "tree-sitter==0.26.0 \\",
  "    --hash=sha256:ggg",
  "tree-sitter-c-sharp==0.23.5 \\",
  "    --hash=sha256:hhh",
  "tree-sitter-embedded-template==0.25.0 \\",
  "    --hash=sha256:iii",
  "tree-sitter-language-pack==0.13.0 \\",
  "    --hash=sha256:jjj",
  "tree-sitter-yaml==0.7.2 \\",
  "    --hash=sha256:kkk",
  "",
].join("\n");

test("the lock keeps only the packages cg imports, each with its hashes", () => {
  const lock = b.filterLock(COMPILED);
  const pins = lock.split("\n").filter((l) => /^[a-z]/i.test(l));
  assert.deepStrictEqual(pins, [
    "code-review-graph==2.3.9 \\",
    "networkx==3.7 \\",
    "pyyaml==6.0.3 \\",
    "tree-sitter==0.26.0 \\",
    "tree-sitter-c-sharp==0.23.5 \\",
    "tree-sitter-embedded-template==0.25.0 \\",
    "tree-sitter-language-pack==0.13.0 \\",
    "tree-sitter-yaml==0.7.2 \\",
  ]);
  assert.match(lock, /code-review-graph==2\.3\.9 \\\n {4}--hash=sha256:ccc\n/);
  assert.doesNotMatch(lock, /anyio|fastmcp|# via/);
  assert.match(lock, /^# /, "the file says what it is and how to regenerate it");
});

test("the lock refuses a resolution that lacks a package cg imports", () => {
  const without = COMPILED.replace(/networkx==3\.7 \\\n {4}--hash=sha256:eee\n/, "");
  assert.throws(() => b.filterLock(without), /networkx/);
});

test("the lock's code-review-graph version is read back, and must equal VERSION in cg.cjs", () => {
  const lock = b.filterLock(COMPILED);
  assert.strictEqual(b.lockVersion(lock), "2.3.9");
  assert.strictEqual(b.lockVersion("networkx==3.7\n"), null);
  assert.doesNotThrow(() => b.checkLock(lock, "2.3.9"));
  assert.throws(() => b.checkLock(lock, "2.4.0"), /2\.3\.9.*2\.4\.0.*code-graph-bundle\.cjs lock/s);
});

test("the committed lock matches VERSION in cg.cjs", () => {
  assert.strictEqual(b.lockVersion(b.readLock()), cg.VERSION);
});

// ---- the release tag -------------------------------------------------------------------------

test("the build key changes with the lock, the Python version and the uv version", () => {
  const k = b.buildKey("lock", "3.13.14", "0.11.32");
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.strictEqual(k, b.buildKey("lock", "3.13.14", "0.11.32"));
  assert.notStrictEqual(k, b.buildKey("lock2", "3.13.14", "0.11.32"));
  assert.notStrictEqual(k, b.buildKey("lock", "3.13.15", "0.11.32"));
  assert.notStrictEqual(k, b.buildKey("lock", "3.13.14", "0.11.33"));
});

test("the next tag is build 1, the next free build, or nothing when this build is already released", () => {
  const rel = (tag, key) => ({ tag, body: `Bundle of code-review-graph.\n\nbundle key: ${key}\n` });
  assert.strictEqual(b.nextTag("2.3.9", "k1", []), "code-graph-2.3.9-1");
  assert.strictEqual(b.nextTag("2.3.9", "k1", [rel("code-graph-2.3.9-1", "k1")]), null);
  assert.strictEqual(b.nextTag("2.3.9", "k2", [rel("code-graph-2.3.9-1", "k1")]), "code-graph-2.3.9-2");
  // A forced rebuild takes the next number even for a key already released.
  assert.strictEqual(b.nextTag("2.3.9", "k1", [rel("code-graph-2.3.9-1", "k1")], true), "code-graph-2.3.9-2");
  // Other versions, the global rules' releases and look-alike tags do not count.
  const others = [rel("code-graph-2.3.8-4", "k1"), rel("v2026.10.16.3", "k1"), rel("code-graph-2.3.9-x", "k9"), rel("code-graph-2.3.99-1", "k9")];
  assert.strictEqual(b.nextTag("2.3.9", "k1", others), "code-graph-2.3.9-1");
  assert.strictEqual(b.nextTag("2.3.9", "k1", [rel("code-graph-2.3.9-1", "k0"), rel("code-graph-2.3.9-3", "k3")]), "code-graph-2.3.9-4");
});

// ---- licenses --------------------------------------------------------------------------------

const MIT = "The MIT License (MIT)\n\nCopyright (c) 2017\n\nPermission is hereby granted, free of charge, to any person obtaining a copy";
const APACHE = "\n                                 Apache License\n                           Version 2.0, January 2004\n";
const MPL = "Mozilla Public License Version 2.0\n==================================\n... GNU Affero General Public License, Version 3.0 ...";
const AGPL = "                    GNU AFFERO GENERAL PUBLIC LICENSE\n                       Version 3, 19 November 2007";
const GPL = "                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007";
const LGPL = "                   GNU LESSER GENERAL PUBLIC LICENSE\n                       Version 2.1, February 1999";
const BSD3 = "Redistribution and use in source and binary forms ... Redistributions in binary form must reproduce ... Neither the name of the copyright holder";
const BSD2 = "Redistribution and use in source and binary forms ... Redistributions in binary form must reproduce the above copyright notice";
const ISC = "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted";
const WTFPL = "           DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE\n                   Version 2, December 2004";

test("a license text is classified by its wording, an SPDX line first", () => {
  assert.strictEqual(b.classifyLicense(MIT), "MIT");
  assert.strictEqual(b.classifyLicense(APACHE), "Apache-2.0");
  assert.strictEqual(b.classifyLicense(MPL), "MPL-2.0", "the MPL names the AGPL as a secondary license");
  assert.strictEqual(b.classifyLicense(AGPL), "AGPL-3.0");
  assert.strictEqual(b.classifyLicense(GPL), "GPL");
  assert.strictEqual(b.classifyLicense(LGPL), "LGPL");
  assert.strictEqual(b.classifyLicense(BSD3), "BSD-3-Clause");
  assert.strictEqual(b.classifyLicense(BSD2), "BSD-2-Clause");
  assert.strictEqual(b.classifyLicense(ISC), "ISC");
  assert.strictEqual(b.classifyLicense(WTFPL), "WTFPL");
  assert.strictEqual(b.classifyLicense("This is free and unencumbered software released into the public domain."), "Unlicense");
  assert.strictEqual(b.classifyLicense("SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception\n"), "Apache-2.0 WITH LLVM-exception");
  assert.strictEqual(b.classifyLicense("All rights reserved."), "UNKNOWN");
});

test("an expression is allowed when one OR branch has only allowed terms", () => {
  for (const ok of ["MIT", "MIT OR Apache-2.0", "Apache-2.0 OR BSD-3-Clause", "(MIT OR Apache-2.0)", "Apache-2.0 WITH LLVM-exception", "BSD", "PSF-2.0", "MPL-2.0", "ISC", "Unlicense", "CC0-1.0", "WTFPL", "MIT AND BSD-3-Clause"]) {
    assert.ok(b.licenseAllowed(ok), ok);
  }
  for (const bad of ["GPL", "GPL-3.0-only", "LGPL", "AGPL-3.0", "UNKNOWN", "", "MIT AND GPL-2.0-only", "Apache-2.0 WITH Some-exception"]) {
    assert.ok(!b.licenseAllowed(bad), bad);
  }
  assert.ok(b.licenseAllowed("GPL-3.0-only OR MIT"), "dual licensed: the MIT branch applies");
});

test("a package's license comes from License-Expression, then its classifiers, then License", () => {
  assert.strictEqual(b.packageLicense("Name: networkx\nLicense-Expression: BSD-3-Clause\nClassifier: License :: OSI Approved :: MIT License\n"), "BSD-3-Clause");
  assert.strictEqual(b.packageLicense("Name: PyYAML\nLicense: MIT\nClassifier: License :: OSI Approved :: MIT License\n"), "MIT");
  assert.strictEqual(b.packageLicense("Name: x\nClassifier: License :: OSI Approved :: Apache Software License\n"), "Apache-2.0");
  assert.strictEqual(b.packageLicense("Name: x\nClassifier: License :: OSI Approved :: BSD License\n"), "BSD");
  assert.strictEqual(b.packageLicense("Name: x\nLicense: MIT\n"), "MIT");
  assert.strictEqual(b.packageLicense("Name: x\n"), "UNKNOWN");
  assert.strictEqual(b.packageLicense("Name: x\nClassifier: License :: OSI Approved :: GNU General Public License v3 (GPLv3)\n"), "GPL");
});

// ---- the trim --------------------------------------------------------------------------------

test("the trim removes what cg never loads and keeps the tool, its packages and the mapped grammars", () => {
  const keep = ["rust", "python", "gdscript"];
  const removed = [
    "lib/python3.13/test/",
    "lib/python3.13/idlelib/",
    "lib/python3.13/tkinter/",
    "lib/python3.13/turtledemo/",
    "lib/python3.13/ensurepip/",
    "lib/python3.13/lib-dynload/_dbm.cpython-313-x86_64-linux-gnu.so",
    "lib/python3.13/lib-dynload/_tkinter.cpython-313-x86_64-linux-gnu.so",
    "lib/python3.13/config-3.13-x86_64-linux-gnu/libpython3.13.a",
    "lib/python3.13/json/__pycache__/",
    "lib/python3.13/site-packages/pip/",
    "lib/python3.13/site-packages/pip-26.1.2.dist-info/",
    "lib/python3.13/site-packages/tree_sitter_language_pack/bindings/cobol.abi3.so",
    "lib/libtcl9.0.so",
    "lib/libtcl9tk9.0.so",
    "lib/tcl9.0/",
    "lib/tk9.0/",
    "lib/itcl4.3.2/",
    "lib/thread3.0.1/",
    "lib/libpython3.13.a",
    "include/",
    "share/",
    "bin/pip3",
    "bin/idle3.13",
    "bin/pydoc3",
    "bin/python3-config",
  ];
  const kept = [
    "bin/python3",
    "bin/python3.13",
    "bin/code-review-graph",
    "lib/libpython3.13.so.1.0",
    "lib/python3.13/json/__init__.py",
    "lib/python3.13/LICENSE.txt",
    "lib/python3.13/lib-dynload/_ssl.cpython-313-x86_64-linux-gnu.so",
    "lib/python3.13/site-packages/code_review_graph/",
    "lib/python3.13/site-packages/networkx/",
    "lib/python3.13/site-packages/tree_sitter_language_pack/__init__.py",
    "lib/python3.13/site-packages/tree_sitter_language_pack/bindings/__init__.py",
    "lib/python3.13/site-packages/tree_sitter_language_pack/bindings/rust.abi3.so",
    "lib/python3.13/site-packages/tree_sitter_language_pack/bindings/gdscript.abi3.so",
    "lib/python3.13/site-packages/tree_sitter_yaml/",
  ];
  for (const p of removed) assert.ok(b.trimmed(p, keep), `${p} should go`);
  for (const p of kept) assert.ok(!b.trimmed(p, keep), `${p} should stay`);
});
