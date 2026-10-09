# Checks out enjay27/claude-global into ~/.claude on Windows, once (docs/global-rules-plan.md,
# section 7). macOS and Linux: setup/local-setup.sh.
#
# Run it from PowerShell, not Git Bash: Git Bash turns the sparse-checkout paths (/CLAUDE.md ...)
# into Windows paths before git sees them.
#   powershell -ExecutionPolicy Bypass -File local-setup.ps1
#
# Stops before changing anything if ~/.claude is already a git repository, if settings.json has
# hook entries of its own in ~/.claude/hooks/ (global-sync owns that folder), or if a file of
# yours is in the way of the checkout. An existing ~/.claude/CLAUDE.md is kept as
# ~/.claude/rules/local.md, a personal rule that is loaded but never tracked.
# CLAUDE_GLOBAL_REMOTE overrides the repository, for tests. Written for Windows PowerShell 5.1.
$ErrorActionPreference = 'Continue'
$remote = 'https://github.com/enjay27/claude-global'
if ($env:CLAUDE_GLOBAL_REMOTE) { $remote = $env:CLAUDE_GLOBAL_REMOTE }
$c = Join-Path $HOME '.claude'
New-Item -ItemType Directory -Force $c | Out-Null
Set-Location $c

function Fail([string]$msg) { [Console]::Error.WriteLine("local-setup: $msg"); exit 1 }

if (Test-Path .git) { Fail '~/.claude is already a git repository; nothing was changed.' }
if (Test-Path settings.json) {
  $own = Select-String -Path settings.json -Pattern '\.claude[\\/]+hooks'
  if ($own) {
    $own | ForEach-Object { [Console]::Error.WriteLine("  $($_.Line.Trim())") }
    Fail 'settings.json has hooks in ~/.claude/hooks/ that global-sync would replace; nothing was changed.'
  }
}
if ((Test-Path CLAUDE.md) -and (Test-Path rules/local.md)) {
  Fail 'both CLAUDE.md and rules/local.md exist; merge them first. Nothing was changed.'
}

# Any release will do: global-sync --install moves to the latest one.
$tag = git ls-remote --tags --refs $remote 'v*' |
  ForEach-Object { ($_ -split 'refs/tags/')[1] } |
  Where-Object { $_ -match '^v\d+(\.\d+)*$' } |
  Select-Object -First 1
if (-not $tag) { Fail "no release tag found at $remote; nothing was changed." }

$script:moved = $false
if (Test-Path CLAUDE.md) {
  New-Item -ItemType Directory -Force rules | Out-Null
  Move-Item CLAUDE.md rules/local.md
  $script:moved = $true
}

function Undo([string]$msg) {
  Remove-Item -Recurse -Force .git -ErrorAction SilentlyContinue
  if ($script:moved) {
    Move-Item rules/local.md CLAUDE.md
    if (-not (Get-ChildItem rules)) { Remove-Item rules }
  }
  Fail "$msg; nothing was changed."
}

git init -q
if ($LASTEXITCODE) { Undo 'git init failed' }
git remote add origin $remote
if ($LASTEXITCODE) { Undo 'git remote add failed' }
git sparse-checkout set --no-cone /CLAUDE.md /rules/ /hooks/ /settings.global.json /.gitignore /.gitattributes
if ($LASTEXITCODE) { Undo 'git sparse-checkout failed' }
git fetch -q --depth 1 origin tag $tag
if ($LASTEXITCODE) { Undo "could not fetch $tag" }

# A sparse checkout overwrites untracked files at its paths without failing (git 2.43), so look
# for files of yours in the way before checking out.
$inWay = git ls-tree -r --name-only $tag -- CLAUDE.md rules hooks settings.global.json .gitignore .gitattributes |
  Where-Object { Test-Path -LiteralPath $_ }
if ($inWay) {
  $inWay | ForEach-Object { [Console]::Error.WriteLine("  $_") }
  Undo 'these files of yours are in the way of the checkout'
}
git checkout -q --detach $tag
if ($LASTEXITCODE) { Undo 'the checkout failed' }

node hooks/global-sync.cjs --install
if ($LASTEXITCODE) { Fail 'global-sync --install failed' }
Write-Output "local-setup: $(Get-Content CLAUDE.md -TotalCount 1)"
$status = git status --short
if ($status) { $status; Fail '~/.claude has untracked or changed files (above)' }
if ($script:moved) { Write-Output 'local-setup: your previous CLAUDE.md is now ~/.claude/rules/local.md' }
exit 0
