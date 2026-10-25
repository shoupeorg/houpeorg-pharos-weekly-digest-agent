$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
$SafeProject = $Project -replace '\\','/'
$Base = 'https://pharos-weekly-digest-agent.shoupeorg.workers.dev'
Set-Location -LiteralPath $Project

Write-Host '==> Verify existing authentication'
npx wrangler whoami
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare authentication is unavailable. Run npx wrangler login once, then rerun this resume script.' }

Write-Host '==> Reuse or create exact D1 database'
$Databases = npx wrangler d1 list --json | ConvertFrom-Json
$Database = $Databases | Where-Object { $_.name -eq 'pharos-weekly-digest-agent' } | Select-Object -First 1
if (-not $Database) {
  $Created = npx wrangler d1 create pharos-weekly-digest-agent --json | ConvertFrom-Json
  if ($Created.uuid) { $DatabaseId = [string]$Created.uuid } else { $DatabaseId = [string]$Created.database_id }
} else {
  if ($Database.uuid) { $DatabaseId = [string]$Database.uuid } else { $DatabaseId = [string]$Database.database_id }
}
if ($DatabaseId -notmatch '^[0-9a-f-]{36}$') { throw "Unable to resolve D1 database ID from Wrangler JSON." }
$Config = Get-Content -Raw -LiteralPath '.\wrangler.jsonc'
$Config = $Config -replace '"database_id":"[^"]+"', ('"database_id":"' + $DatabaseId + '"')
Set-Content -LiteralPath '.\wrangler.jsonc' -Value $Config -NoNewline

Write-Host '==> Apply migration and deploy application'
npx wrangler d1 migrations apply pharos-weekly-digest-agent --remote
if ($LASTEXITCODE -ne 0) { throw "D1 migration failed with exit code $LASTEXITCODE" }
npx wrangler deploy --no-bundle
if ($LASTEXITCODE -ne 0) { throw "Deployment failed with exit code $LASTEXITCODE" }

Write-Host '==> Capture one manual and one genuine Cron-triggered publication'
node .\scripts\capture-live-evidence.mjs $Base
if ($LASTEXITCODE -ne 0) { throw "Live evidence capture failed with exit code $LASTEXITCODE" }

Write-Host '==> Publish saved evidence assets only'
New-Item -ItemType Directory -Force -Path '.\public\evidence' | Out-Null
Copy-Item -LiteralPath '.\evidence\manifest-v1.json' -Destination '.\public\evidence\manifest-v1.json' -Force
Copy-Item -LiteralPath '.\evidence\live-manual-v1.json' -Destination '.\public\evidence\live-manual-v1.json' -Force
Copy-Item -LiteralPath '.\evidence\live-scheduled-v1.json' -Destination '.\public\evidence\live-scheduled-v1.json' -Force
npx wrangler deploy --no-bundle
if ($LASTEXITCODE -ne 0) { throw "Evidence asset deployment failed with exit code $LASTEXITCODE" }

Write-Host '==> Commit and push exact source/evidence'
git -c "safe.directory=$SafeProject" add wrangler.jsonc evidence public/evidence scripts
git -c "safe.directory=$SafeProject" diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git -c "safe.directory=$SafeProject" commit -m 'Configure production D1 and publish live digest evidence' }
if ($LASTEXITCODE -ne 0) { throw "Git commit failed with exit code $LASTEXITCODE" }
git -c "safe.directory=$SafeProject" push -u origin main
if ($LASTEXITCODE -ne 0) { throw "Git push failed with exit code $LASTEXITCODE" }

Write-Host '==> Verify public application and remote commit'
& .\scripts\verify-public.ps1
git -c "safe.directory=$SafeProject" fetch origin main
$Local = (git -c "safe.directory=$SafeProject" rev-parse HEAD).Trim()
$Remote = (git -c "safe.directory=$SafeProject" rev-parse origin/main).Trim()
if ($Local -ne $Remote) { throw "Commit mismatch: local=$Local remote=$Remote" }
$Manifest = Invoke-RestMethod -Uri "$Base/evidence/manifest-v1.json" -TimeoutSec 30
[pscustomobject]@{ commit = $Local; demo = $Base; databaseId = $DatabaseId; manual = $Manifest.manual.permalink; scheduled = $Manifest.scheduled.permalink; schedulerLatenessMs = $Manifest.scheduled.latenessMs } | ConvertTo-Json
