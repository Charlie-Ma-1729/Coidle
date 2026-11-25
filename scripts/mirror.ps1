# Windows mirror checker for Coidle (the Z: folder is the live Ubuntu server folder; never npm ci / tsc / vitest there).
# Usage: powershell -File scripts/mirror.ps1 [-Tests "server/src/a.test.ts client/src/ui.test.tsx"] [-NoTsc] [-Dir <mirror dir>]
# Syncs the project into a mirror (default %TEMP%\coidle-mirror), runs npm ci only when needed, then typecheck and optional vitest.
# Run other scripts in the mirror, e.g.:  cd <mirror>; npx tsx --tsconfig tsconfig.json server/src/bots/pricesweep.ts 40 lazy
param(
  [string]$Tests = "",
  [switch]$NoTsc,
  [string]$Dir = (Join-Path $env:TEMP "coidle-mirror")
)
$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force $Dir | Out-Null
# /XD /XF also protect the mirror's own node_modules from /MIR purging. Exit code < 8 is success.
robocopy $src $Dir /MIR /XD node_modules .git data backups dist .claude /XF ".env*" "*.db" "*.db-wal" "*.db-shm" /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
Push-Location $Dir
try {
  $stamp = Join-Path $Dir "node_modules\.package-lock.json"
  if (-not (Test-Path $stamp) -or (Get-Item (Join-Path $Dir "package-lock.json")).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  }
  if (-not $NoTsc) {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }
  }
  if ($Tests) {
    # do not pass --exclude to vitest: it breaks the @coidle/shared alias
    npx vitest run @($Tests -split "\s+" | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { throw "vitest failed" }
  }
} finally {
  Pop-Location
}
