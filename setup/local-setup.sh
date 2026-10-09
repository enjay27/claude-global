#!/bin/bash
# Checks out enjay27/claude-global into ~/.claude on a Mac or Linux machine, once
# (docs/global-rules-plan.md, section 7). Windows: setup/local-setup.ps1, from PowerShell.
#
# Stops before changing anything if ~/.claude is already a git repository, if settings.json has
# hook entries of its own in ~/.claude/hooks/ (global-sync owns that folder), or if a file of
# yours is in the way of the checkout. An existing ~/.claude/CLAUDE.md is kept as
# ~/.claude/rules/local.md, a personal rule that is loaded but never tracked.
#
# Usage: bash local-setup.sh
# For tests: CLAUDE_GLOBAL_HOME replaces the home folder, CLAUDE_GLOBAL_REMOTE the repository.
set -u
remote="${CLAUDE_GLOBAL_REMOTE:-https://github.com/enjay27/claude-global}"
c="${CLAUDE_GLOBAL_HOME:-$HOME}/.claude"
mkdir -p "$c" && cd "$c" || exit 1

fail() { echo "local-setup: $*" >&2; exit 1; }

[ -e .git ] && fail "~/.claude is already a git repository; nothing was changed."
if [ -f settings.json ] && grep -Eq '\.claude[\\/]+hooks' settings.json; then
  grep -En '\.claude[\\/]+hooks' settings.json >&2
  fail "settings.json has hooks in ~/.claude/hooks/ that global-sync would replace; nothing was changed."
fi
[ -f CLAUDE.md ] && [ -e rules/local.md ] && fail "both CLAUDE.md and rules/local.md exist; merge them first. Nothing was changed."

# Any release will do: global-sync --install moves to the latest one.
tag=$(git ls-remote --tags --refs "$remote" 'v*' | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+(\.[0-9]+)*$' | head -n 1)
[ -n "$tag" ] || fail "no release tag found at $remote; nothing was changed."

moved=no
if [ -f CLAUDE.md ]; then mkdir -p rules && mv CLAUDE.md rules/local.md && moved=yes; fi

undo() {
  rm -rf .git
  [ "$moved" = yes ] && mv rules/local.md CLAUDE.md && rmdir rules 2>/dev/null
  fail "$1; nothing was changed."
}

git init -q && git remote add origin "$remote" \
  && git sparse-checkout set --no-cone /CLAUDE.md /rules/ /hooks/ /settings.global.json /.gitignore /.gitattributes \
  && git fetch -q --depth 1 origin tag "$tag" \
  || undo "could not fetch $tag"
# A sparse checkout overwrites untracked files at its paths without failing (git 2.43), so look
# for files of yours in the way before checking out.
in_way=$(git ls-tree -r --name-only "$tag" -- CLAUDE.md rules hooks settings.global.json .gitignore .gitattributes \
  | while IFS= read -r f; do [ -e "$f" ] && echo "  $f"; done)
[ -z "$in_way" ] || { echo "$in_way" >&2; undo "these files of yours are in the way of the checkout"; }
git checkout -q --detach "$tag" || undo "the checkout failed"

node hooks/global-sync.cjs --install || fail "global-sync --install failed"
echo "local-setup: $(head -n 1 CLAUDE.md)"
[ -z "$(git status --short)" ] || { git status --short; fail "~/.claude has untracked or changed files (above)"; }
[ "$moved" = yes ] && echo "local-setup: your previous CLAUDE.md is now ~/.claude/rules/local.md"
exit 0
