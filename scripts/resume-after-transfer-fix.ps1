$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
$SafeProject = $Project -replace '\\','/'
$Base = 'https://pharos-weekly-digest-agent.shoupeorg.workers.dev'
Set-Location -LiteralPath $Project

Write-Host '==> Inspect existing jobs before retry'
$JobsRaw = @(& npx wrangler d1 execute pharos-weekly-digest-agent --remote --command "SELECT j.id,j.kind,j.status,j.due_at,j.started_at,j.completed_at,j.error,s.label FROM jobs j JOIN subscriptions s ON s.id=j.subscription_id ORDER BY j.created_at DESC LIMIT 30" --json 2>&1)
$JobsExit = $LASTEXITCODE
if ($JobsExit -ne 0) { throw "D1 job inspection failed with exit code $JobsExit.`n$($JobsRaw -join [Environment]::NewLine)" }
try { $Jobs = ($JobsRaw -join [Environment]::NewLine) | ConvertFrom-Json } catch { throw "D1 job inspection returned invalid JSON: $($_.Exception.Message)" }
New-Item -ItemType Directory -Force -Path '.\evidence' | Out-Null
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $Project 'evidence\pre-retry-jobs-v1.json'), ($Jobs | ConvertTo-Json -Depth 10), $Utf8NoBom)

Write-Host '==> Deploy exact amount-normalization correction once'
npx wrangler deploy --no-bundle
if ($LASTEXITCODE -ne 0) { throw "Correction deployment failed with exit code $LASTEXITCODE" }

Write-Host '==> Resume evidence capture only'
node .\scripts\capture-live-evidence.mjs $Base
if ($LASTEXITCODE -ne 0) { throw "Live evidence capture failed with exit code $LASTEXITCODE" }

Write-Host '==> Publish evidence assets'
New-Item -ItemType Directory -Force -Path '.\public\evidence' | Out-Null
Copy-Item -LiteralPath '.\evidence\manifest-v1.json' -Destination '.\public\evidence\manifest-v1.json' -Force
Copy-Item -LiteralPath '.\evidence\live-manual-v1.json' -Destination '.\public\evidence\live-manual-v1.json' -Force
Copy-Item -LiteralPath '.\evidence\live-scheduled-v1.json' -Destination '.\public\evidence\live-scheduled-v1.json' -Force
Copy-Item -LiteralPath '.\evidence\pre-retry-jobs-v1.json' -Destination '.\public\evidence\pre-retry-jobs-v1.json' -Force
Copy-Item -LiteralPath '.\evidence\upstream-amount-diagnostic-v1.json' -Destination '.\public\evidence\upstream-amount-diagnostic-v1.json' -Force
npx wrangler deploy --no-bundle
if ($LASTEXITCODE -ne 0) { throw "Evidence asset deployment failed with exit code $LASTEXITCODE" }

Write-Host '==> Commit and push correction plus genuine evidence'
git -c "safe.directory=$SafeProject" add src test scripts wrangler.jsonc evidence public/evidence STATUS.md
git -c "safe.directory=$SafeProject" diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git -c "safe.directory=$SafeProject" commit -m 'Fix exact SocialScan amounts and publish scheduled evidence' }
if ($LASTEXITCODE -ne 0) { throw "Git commit failed with exit code $LASTEXITCODE" }
git -c "safe.directory=$SafeProject" push -u origin main
if ($LASTEXITCODE -ne 0) { throw "Git push failed with exit code $LASTEXITCODE" }

Write-Host '==> Verify public UI, API, archive, exports, evidence, and Git'
& .\scripts\verify-public.ps1
$Manifest = Invoke-RestMethod -Uri "$Base/evidence/manifest-v1.json" -TimeoutSec 30
$ManualJson = Invoke-WebRequest -UseBasicParsing -Uri ($Base + $Manifest.manual.permalink + '?format=json') -TimeoutSec 30
$ManualMarkdown = Invoke-WebRequest -UseBasicParsing -Uri ($Base + $Manifest.manual.permalink + '?format=md') -TimeoutSec 30
$ScheduledJson = Invoke-WebRequest -UseBasicParsing -Uri ($Base + $Manifest.scheduled.permalink + '?format=json') -TimeoutSec 30
if ($ManualJson.StatusCode -ne 200 -or $ManualJson.Headers['Content-Type'] -notmatch 'application/json') { throw 'Manual JSON export verification failed.' }
if ($ManualMarkdown.StatusCode -ne 200 -or $ManualMarkdown.Headers['Content-Type'] -notmatch 'text/markdown') { throw 'Manual Markdown export verification failed.' }
if ($ScheduledJson.StatusCode -ne 200 -or $ScheduledJson.Content -notmatch 'DEMO SCHEDULE') { throw 'Scheduled digest verification failed.' }
git -c "safe.directory=$SafeProject" fetch origin main
$Local = (git -c "safe.directory=$SafeProject" rev-parse HEAD).Trim()
$Remote = (git -c "safe.directory=$SafeProject" rev-parse origin/main).Trim()
if ($Local -ne $Remote) { throw "Commit mismatch: local=$Local remote=$Remote" }
[pscustomobject]@{ commit=$Local; demo=$Base; manual=($Base+$Manifest.manual.permalink); scheduled=($Base+$Manifest.scheduled.permalink); schedulerLatenessMs=$Manifest.scheduled.latenessMs; coverage=@($Manifest.manual.coverage,$Manifest.scheduled.coverage) } | ConvertTo-Json
