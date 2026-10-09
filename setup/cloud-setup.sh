#!/bin/bash
# Paste into the cloud environment's setup script (docs/global-rules-plan.md, section 7).
# Checks out enjay27/claude-global into ~/.claude, sparse and allowlisted, then registers the
# user-level hook. Fails soft: on any fetch error the session still starts and says so first.
ref=claude/step1-cloud-probe   # a branch for step 1; from the first release a tag, e.g. v2026.10.12
c="$HOME/.claude"
mkdir -p "$c" && cd "$c" || exit 0
[ -d .git ] || git init -q
git remote get-url origin >/dev/null 2>&1 \
  || git remote add origin https://github.com/enjay27/claude-global
git sparse-checkout set --no-cone /CLAUDE.md /rules/ /hooks/ /settings.global.json /.gitignore /.gitattributes
if git fetch -q --depth 1 origin "$ref" && git checkout -q -f --detach FETCH_HEAD; then
  git show HEAD:deploy-exclude > .git/info/exclude
  for h in hooks/global-sync.cjs hooks/probe.cjs; do
    [ -f "$h" ] && { node "$h" --install; break; }
  done
else
  echo "GLOBAL RULES FAILED TO LOAD ($ref). Tell Kade before doing anything else." > CLAUDE.md
fi
exit 0
