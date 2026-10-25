$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Project = 'C:\Users\KENAAR\Documents\Codex\2026-10-13\create-a-new-github-repository-named\work\pharos-weekly-digest-agent'
$Safe = 'C:/Users/KENAAR/Documents/Codex/2026-10-13/create-a-new-github-repository-named/work/pharos-weekly-digest-agent'
$Base = 'https://pharos-weekly-digest-agent.shoupeorg.workers.dev'
Set-Location -LiteralPath $Project

Write-Host '==> Deploy tested coverage correction (no login or migration)' -ForegroundColor Cyan
& npx.cmd wrangler deploy --no-bundle
if ($LASTEXITCODE -ne 0) { throw "Coverage-correction deployment failed with exit code $LASTEXITCODE" }

Write-Host '==> Capture only corrected versioned evidence' -ForegroundColor Cyan
& node.exe scripts/capture-coverage-correction.mjs $Base
if ($LASTEXITCODE -ne 0) { throw "Coverage evidence capture failed with exit code $LASTEXITCODE" }

Copy-Item -LiteralPath evidence/live-manual-v1.1.json -Destination public/evidence/live-manual-v1.1.json -Force
Copy-Item -LiteralPath evidence/live-scheduled-v1.1.json -Destination public/evidence/live-scheduled-v1.1.json -Force
Copy-Item -LiteralPath evidence/manifest-v1.1.json -Destination public/evidence/manifest-v1.1.json -Force

if ((Get-Content STATUS.md -Raw) -notmatch 'Coverage correction verified') {
  Add-Content STATUS.md @'

## Coverage correction verified

- Versioned v1.1 manual and genuine scheduler reports prove COMPLETE source coverage for both full periods.
- Historical v1 PARTIAL reports remain unchanged and documented as non-comparable.
- Public UI, archive, JSON/Markdown exports, scheduler provenance, and evidence assets were verified after deployment.
'@
}

Write-Host '==> Deploy only the newly captured public evidence assets' -ForegroundColor Cyan
& npx.cmd wrangler deploy --no-bundle
if ($LASTEXITCODE -ne 0) { throw "Evidence asset deployment failed with exit code $LASTEXITCODE" }

Write-Host '==> Verify public UI, API, archive, evidence and exports' -ForegroundColor Cyan
$Ui = Invoke-WebRequest -UseBasicParsing -Uri "$Base/" -TimeoutSec 30
$Meta = Invoke-RestMethod -Uri "$Base/api/meta" -TimeoutSec 30
$Manifest = Invoke-RestMethod -Uri "$Base/evidence/manifest-v1.1.json" -TimeoutSec 30
if ($Ui.StatusCode -ne 200 -or $Ui.Content -notmatch 'Pharos Weekly Digest Agent') { throw 'Public UI verification failed.' }
if ($Meta.chainId -ne 1672 -or $Meta.engineVersion -ne 'weekly-digest/1.0.2-coverage-proof') { throw 'Public API version verification failed.' }
foreach ($Name in @('manual','scheduled')) {
  $Item = $Manifest.$Name
  if ($Item.coverage -ne 'COMPLETE' -or $Item.currentEvents -lt 1 -or $Item.previousEvents -lt 1 -or $Item.topEvents -lt 1) { throw "$Name coverage/evidence assertion failed." }
  $Json = Invoke-RestMethod -Uri ($Base + $Item.permalink + '?format=json') -TimeoutSec 30
  $Markdown = Invoke-WebRequest -UseBasicParsing -Uri ($Base + $Item.permalink + '?format=md') -TimeoutSec 30
  if ($Json.coverage.status -ne 'COMPLETE' -or $Markdown.StatusCode -ne 200 -or $Markdown.Headers['Content-Type'] -notmatch 'text/markdown') { throw "$Name public report/export verification failed." }
}
$Archive = Invoke-RestMethod -Uri "$Base/api/archive" -TimeoutSec 30
if (@($Archive.digests).Count -lt 5) { throw 'Public archive did not retain historical and corrected reports.' }

git -c "safe.directory=$Safe" add evidence/live-manual-v1.1.json evidence/live-scheduled-v1.1.json evidence/manifest-v1.1.json public/evidence/live-manual-v1.1.json public/evidence/live-scheduled-v1.1.json public/evidence/manifest-v1.1.json STATUS.md scripts/resume-coverage-publication.ps1
if ($LASTEXITCODE -ne 0) { throw 'Git add failed.' }
git -c "safe.directory=$Safe" diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git -c "safe.directory=$Safe" commit -m 'Publish complete weekly coverage evidence'
  if ($LASTEXITCODE -ne 0) { throw 'Git commit failed.' }
}
git -c "safe.directory=$Safe" push -u origin main
if ($LASTEXITCODE -ne 0) { throw 'Git push failed.' }
git -c "safe.directory=$Safe" fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'Git fetch failed.' }
$Local = (git -c "safe.directory=$Safe" rev-parse HEAD).Trim()
$Remote = (git -c "safe.directory=$Safe" rev-parse origin/main).Trim()
if ($Local -ne $Remote) { throw "Commit mismatch: local=$Local remote=$Remote" }

[pscustomobject]@{
  commit = $Local
  repository = 'https://github.com/shoupeorg/shoupeorg-pharos-weekly-digest-agent'
  demo = $Base
  manual = $Base + $Manifest.manual.permalink
  scheduled = $Base + $Manifest.scheduled.permalink
  schedulerLatenessMs = $Manifest.scheduled.latenessMs
  coverage = @($Manifest.manual.coverage, $Manifest.scheduled.coverage)
  archiveEntries = @($Archive.digests).Count
} | ConvertTo-Json
