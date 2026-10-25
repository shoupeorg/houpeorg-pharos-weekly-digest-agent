$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Project
git -c "safe.directory=$Project" push -u origin main
if ($LASTEXITCODE -ne 0) { throw "Git push failed with exit code $LASTEXITCODE" }
$Local = (git -c "safe.directory=$Project" rev-parse HEAD).Trim()
git -c "safe.directory=$Project" fetch origin main
if ($LASTEXITCODE -ne 0) { throw "Git fetch failed with exit code $LASTEXITCODE" }
$Remote = (git -c "safe.directory=$Project" rev-parse origin/main).Trim()
if ($Local -ne $Remote) { throw "Commit mismatch: local=$Local remote=$Remote" }
Write-Host "PUBLICATION VERIFIED: $Remote" -ForegroundColor Green
