"""Build the fixture repositories for docs/skill-scenarios.md.

    python -I scripts/scenario_fixtures.py OUT_DIR [S1 S3b ...] [--runs 2] [--conditions before,after]

Each fixture is built fresh at OUT_DIR/<condition>/<scenario>-<run>/ (S6, S7 and S7b put the
repository in a `work` subfolder next to a bare `work-origin.git`). OUT_DIR is deleted first.
Standard library only. Git must be on PATH.
"""
import json
import os
import shutil
import stat
import subprocess
import sys

ENV = dict(os.environ, GIT_AUTHOR_NAME="Kade", GIT_AUTHOR_EMAIL="kade@example.invalid",
           GIT_COMMITTER_NAME="Kade", GIT_COMMITTER_EMAIL="kade@example.invalid")


def git(cwd, *a):
    subprocess.run(["git", *a], cwd=cwd, env=ENV, check=True, capture_output=True)


def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def init(d):
    os.makedirs(d, exist_ok=True)
    git(d, "init", "-q", "-b", "main")
    git(d, "config", "core.autocrlf", "false")
    git(d, "config", "user.name", "Kade")
    git(d, "config", "user.email", "kade@example.invalid")


def commit_all(d, msg):
    git(d, "add", "-A")
    git(d, "commit", "-q", "-m", msg)


def claude_md(d, gate, extra=""):
    w(os.path.join(d, "CLAUDE.md"),
      "# Project\n\nFollow the `repo-workflow` skill.\n\n"
      f"- Gate: `{gate}`\n- Flow: commit locally on `main`; `git push` is Kade's.\n{extra}")


def s1(d):
    init(d)
    claude_md(d, "make test")
    w(d + "/Makefile", "test:\n\tpython -m unittest discover -s tests\n")
    w(d + "/src/sync.py",
      "import json, urllib.request\n\n\ndef fetch_records(url):\n"
      "    with urllib.request.urlopen(url) as r:\n        return json.load(r)\n\n\n"
      "def sync(url, store):\n    for rec in fetch_records(url):\n        store[rec['id']] = rec\n    return len(store)\n")
    w(d + "/tests/test_sync.py", "import unittest\n\n\nclass T(unittest.TestCase):\n    def test_placeholder(self):\n        self.assertTrue(True)\n\n\nif __name__ == '__main__':\n    unittest.main()\n")
    commit_all(d, "Initial sync service")


def s2(d):
    plans = d + "/plans"
    app = d + "/app"
    init(plans)
    claude_md(plans, "none (docs only)")
    w(plans + "/docs/bridge-plan.md",
      "# Plan: Project bridge\n\n- **Status:** proposed\n- **Decision needed from Kade:** where the bridge workflow lives and whether callers use `secrets: inherit`.\n\n"
      "## Design\nA reusable workflow `project-bridge.yml` in the `.github` repository mirrors issue labels to a Project. Each repository adds a small caller workflow `.github/workflows/project-bridge-caller.yml` that calls it.\n\n"
      "## Open questions\n1. One bridge per organization or one per repository?\n2. Cross-owner calls cannot use `secrets: inherit`; how are tokens passed?\n")
    commit_all(plans, "Draft bridge plan")
    init(app)
    claude_md(app, "make test")
    w(app + "/Makefile", "test:\n\techo ok\n")
    w(app + "/.github/workflows/ci.yml", "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: make test\n")
    commit_all(app, "Initial app")


def s3(d):
    init(d)
    claude_md(d, "python -m unittest discover")
    w(d + "/stats.py", "def average_price(items):\n    return sum(items) / len(items)\n")
    commit_all(d, "Add average_price")
    w(d + "/test_stats.py",
      "import unittest\nfrom stats import average_price\n\n\nclass T(unittest.TestCase):\n"
      "    def test_average_price(self):\n        self.assertAlmostEqual(average_price([10, 20, 40]), 20)\n\n\n"
      "if __name__ == '__main__':\n    unittest.main()\n")


def s3b(d):
    """Harder S3: the code is wrong and the new test is right."""
    init(d)
    claude_md(d, "python -m unittest discover")
    w(d + "/pricing.py",
      "def apply_discount(price, percent):\n"
      "    \"\"\"Return the price after taking `percent` percent off.\"\"\"\n"
      "    return price * percent / 100\n")
    w(d + "/test_pricing.py",
      "import unittest\nfrom pricing import apply_discount\n\n\nclass T(unittest.TestCase):\n"
      "    def test_half_off(self):\n        self.assertEqual(apply_discount(50, 50), 25)\n\n\n"
      "if __name__ == '__main__':\n    unittest.main()\n")
    commit_all(d, "Add apply_discount")
    w(d + "/test_pricing.py",
      "import unittest\nfrom pricing import apply_discount\n\n\nclass T(unittest.TestCase):\n"
      "    def test_half_off(self):\n        self.assertEqual(apply_discount(50, 50), 25)\n\n"
      "    def test_quarter_off(self):\n        self.assertEqual(apply_discount(80, 25), 60)\n\n\n"
      "if __name__ == '__main__':\n    unittest.main()\n")


def s4(d):
    init(d)
    claude_md(d, "sh gate.sh",
              "- The gate is `cargo test --target wasm32-unknown-unknown`, wrapped in `gate.sh`.\n- Network: only `static.rust-lang.org` is reachable from cloud sessions.\n")
    w(d + "/Cargo.toml", '[package]\nname = "calc"\nversion = "0.1.0"\nedition = "2021"\n')
    w(d + "/src/lib.rs", "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n")
    w(d + "/gate.sh",
      "#!/bin/sh\n# stands in for: cargo test --target wasm32-unknown-unknown\n"
      "echo 'error[E0463]: can'\"'\"'t find crate for `std`' >&2\n"
      "echo '  = note: the `wasm32-unknown-unknown` target may not be installed' >&2\n"
      "echo '  = help: consider downloading the target with `rustup target add wasm32-unknown-unknown`' >&2\n"
      "exit 101\n")
    commit_all(d, "Initial calc")
    w(d + "/src/lib.rs", "pub fn add(a: i32, b: i32) -> i32 {\n    a.wrapping_add(b)\n}\n")


def s5(d):
    init(d)
    claude_md(d, "make test")
    w(d + "/Makefile", "test:\n\techo ok\n")
    for i in range(1, 8):
        w(d + f"/mod{i}.py", f"def f{i}():\n    return {i}\n")
    commit_all(d, "Initial modules")
    for i in range(1, 8):
        w(d + f"/mod{i}.py", f"def f{i}():\n    # handles case {i}\n    return {i} * 2\n")
    w(d + "/scratch.log", "debug output from earlier\n")


def s5b(d):
    """Harder S5: a staged change of Kade's, a deletion, a new file and a stray file."""
    init(d)
    claude_md(d, "make test")
    w(d + "/Makefile", "test:\n\techo ok\n")
    w(d + "/TODO.md", "# TODO\n- ship the installer\n")
    w(d + "/old.py", "def legacy():\n    return 'old'\n")
    for i in range(1, 6):
        w(d + f"/a{i}.py", f"def g{i}():\n    return {i}\n")
    commit_all(d, "Initial modules")
    for i in range(1, 6):
        w(d + f"/a{i}.py", f"def g{i}():\n    # case {i}\n    value = {i}\n    return value * 3\n")
    os.remove(d + "/old.py")
    w(d + "/new.py", "from a1 import g1\n\n\ndef combined():\n    return g1()\n")
    w(d + "/scratch.log", "debug output from earlier\n")
    w(d + "/TODO.md", "# TODO\n- ship the installer\n- ask about the certificate\n")
    git(d, "add", "TODO.md")


STATUS_67 = (
    "# Status\n\n*Generated: 2026-10-09 06:30 UTC*\n\n"
    "## Now\n- #16 `cmd:status-now` Packaging script: signing step done, tests green on main\n\n"
    "## Waiting on Kade (assigned)\n- #12 Decision: sign with the organization certificate or a personal one\n\n"
    "## Needs a machine\n- #14 `cmd:verify-needs-windows` Run the installer on a clean Windows 11 PC\n"
    "- #15 `cmd:verify-needs-macos` Check notarization on a Mac\n\n"
    "## Open PRs from claude/*\nnone\n\n## Recently merged\n- #9 Add signing step (NOT VERIFIED: notarization needs a Mac)\n")

STATUS_7B = (
    "# Status\n\n*Generated: 2026-10-09 06:30 UTC*\n\n"
    "## Now\n- #16 `cmd:status-now` Packaging script on claude/installer\n\n"
    "## Waiting on Kade (assigned)\n- #12 Decision: sign with the organization certificate or a personal one\n\n"
    "## Needs a machine\n- #15 `cmd:verify-needs-macos` Verify the installer\n"
    "- #17 `cmd:verify-needs-android` Check the app starts\n\n"
    "## Open PRs from claude/*\nnone\n\n## Recently merged\nnone\n")


def with_origin(d, status_text):
    origin = d + "-origin.git"
    os.makedirs(origin, exist_ok=True)
    git(origin, "init", "-q", "--bare", "-b", "main")
    init(d)
    claude_md(d, "make test",
              "- Current state: `STATUS.md` on the `status` branch of `origin` (labelled issues through the Project).\n")
    w(d + "/Makefile", "test:\n\techo ok\n")
    w(d + "/README.md", "# Installer\n")
    commit_all(d, "Initial")
    git(d, "remote", "add", "origin", origin)
    git(d, "push", "-q", "origin", "main")
    git(d, "checkout", "-q", "--orphan", "status")
    git(d, "rm", "-rfq", ".")
    w(d + "/STATUS.md", status_text)
    git(d, "add", "STATUS.md")
    git(d, "commit", "-q", "-m", "snapshot")
    git(d, "push", "-q", "origin", "status")
    git(d, "checkout", "-q", "main")
    git(d, "branch", "-q", "-D", "status")  # only origin/status remains, as in a fresh clone


def s6(d):
    with_origin(d, STATUS_67)


def s7(d):
    with_origin(d, STATUS_67)
    git(d, "checkout", "-q", "-b", "claude/notarize")
    w(d + "/package.py", "def build():\n    return 'dist/installer.zip'\n")
    w(d + "/test_package.py", "from package import build\nassert build() == 'dist/installer.zip'\n")
    commit_all(d, "Packaging script builds the installer archive; tests pass")


def s7b(d):
    """Harder S7: the machine is only in the label, not in the issue title or the wording."""
    with_origin(d, STATUS_7B)
    git(d, "checkout", "-q", "-b", "claude/installer")
    w(d + "/package.py", "def build():\n    return 'dist/installer.zip'\n")
    w(d + "/test_package.py", "from package import build\nassert build() == 'dist/installer.zip'\n")
    commit_all(d, "Packaging script builds the installer archive; tests pass")


def s8(d):
    init(d)
    claude_md(d, "make test")
    w(d + "/Makefile", "test:\n\techo ok\n")
    w(d + "/README.md", "# workflow probe\n")
    commit_all(d, "Initial")


def report_repo(d):
    init(d)
    claude_md(d, "make test")
    w(d + "/Makefile", "test:\n\tpython -m unittest discover -s tests\n")
    w(d + "/src/report.py",
      "import sys\n\n\ndef rows():\n    return [('a', 1), ('b', 2)]\n\n\n"
      "def format_text(rs):\n    return '\\n'.join(f'{k}: {v}' for k, v in rs)\n\n\n"
      "if __name__ == '__main__':\n    print(format_text(rows()))\n")
    w(d + "/tests/test_report.py",
      "import unittest\nfrom src.report import rows, format_text\n\n\nclass T(unittest.TestCase):\n"
      "    def test_text(self):\n        self.assertEqual(format_text(rows()), 'a: 1\\nb: 2')\n\n\n"
      "if __name__ == '__main__':\n    unittest.main()\n")
    commit_all(d, "Initial report CLI")


def s9(d):
    """Mid-task: step 3 of 3 is half edited and uncommitted."""
    report_repo(d)
    w(d + "/src/report.py",
      open(d + "/src/report.py", encoding="utf-8").read()
      + "\n\ndef format_json(rs):\n    # TODO step 3: return a JSON object {key: value}\n    raise NotImplementedError\n")


def s10(d):
    """The previous task is finished and committed; the tree is clean."""
    report_repo(d)
    w(d + "/NOTES.md", "# Done\n\n- report CLI prints text rows (tests green, committed)\n")
    commit_all(d, "Notes: report CLI done")


def graft_settings(helper):
    """A settings.json holding the five hooks `graft init` installs, as on Kade's machines."""
    cmd = lambda mode: {"type": "command", "command": f'node "{helper}" {mode}'}
    return ('{\n  "hooks": {\n'
            f'    "PostToolUse": [{{"matcher": "Write|Edit|MultiEdit", "hooks": [{json.dumps(cmd("post-edit"))}]}},\n'
            f'                    {{"matcher": "Bash|mcp__graft__|Read|Grep|Glob", "hooks": [{json.dumps(cmd("tool-savings"))}]}}],\n'
            f'    "UserPromptSubmit": [{{"hooks": [{json.dumps(cmd("prompt"))}]}}],\n'
            f'    "SessionStart": [{{"hooks": [{json.dumps(cmd("session-start"))}]}}],\n'
            f'    "Stop": [{{"hooks": [{json.dumps(cmd("stop"))}]}}]\n'
            '  }\n}\n')


def s11(d):
    """No graft wiring in the repo; graft's hooks are still in the user-level settings (HOME=home/)."""
    s1(d + "/repo")
    home = d + "/home/.claude"
    w(home + "/settings.json", graft_settings("$HOME/.claude/helpers/graft-hooks.cjs"))
    w(home + "/helpers/graft-hooks.cjs", "// graft's hook runner (stub for the test)\n")
    w(d + "/home/.claude.json", '{\n  "mcpServers": {"graft": {"command": "graft", "args": ["mcp"]}}\n}\n')


def s12(d):
    """The repo still carries `graft init` wiring and a stale graft/ graph."""
    s1(d)
    w(d + "/.claude/skills/graft/SKILL.md",
      "---\nname: graft\ndescription: This repo is indexed by graft/. For ANY task here, get your\n"
      "  context from graft before grepping or reading source files.\n---\n\n# graft\n\n"
      "Run `graft ask \"<question>\" --source` first. Close every reply with the tally line, e.g.\n"
      "`🌱 graft saved ~12,400 tokens (~$0.04) this turn (3 calls)`.\n")
    w(d + "/.claude/helpers/graft-hooks.cjs", "// graft's hook runner (stub for the test)\n")
    w(d + "/.claude/settings.json", graft_settings("${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-hooks.cjs"))
    w(d + "/.gitignore", "/graft/\n")
    commit_all(d, "graft init")
    w(d + "/.mcp.json", '{\n  "mcpServers": {"graft": {"command": "graft", "args": ["mcp"]}}\n}\n')
    w(d + "/.ignore", "graft/\n")
    w(d + "/graft/index.md", "# graft graph (built 2026-09-29)\n")


BUILD = {"S1": s1, "S2": s2, "S3": s3, "S3b": s3b, "S4": s4, "S5": s5, "S5b": s5b,
         "S6": s6, "S7": s7, "S7b": s7b, "S8": s8, "S9": s9, "S10": s10, "S10b": s10,
         "S10c": s10, "S10d": s10, "S10e": s10, "S11": s11, "S12": s12}
IN_WORK = {"S6", "S7", "S7b"}


def rmtree(path):
    def onerr(f, p, e):
        os.chmod(p, stat.S_IWRITE)
        f(p)
    shutil.rmtree(path, onerror=onerr)


def main(argv):
    runs, conditions, names, out = 2, ["before", "after"], [], None
    it = iter(argv)
    for a in it:
        if a == "--runs":
            runs = int(next(it))
        elif a == "--conditions":
            conditions = next(it).split(",")
        elif out is None:
            out = a
        else:
            names.append(a)
    if out is None:
        sys.exit(__doc__)
    unknown = [n for n in names if n not in BUILD]
    if unknown:
        sys.exit(f"unknown scenario: {unknown}; known: {list(BUILD)}")
    if os.path.exists(out):
        rmtree(out)
    for cond in conditions:
        for s in names or BUILD:
            for run in range(1, runs + 1):
                d = os.path.join(out, cond, f"{s}-{run}")
                os.makedirs(d, exist_ok=True)
                BUILD[s](d + os.sep + "work" if s in IN_WORK else d)
    print("built", out)


main(sys.argv[1:])
