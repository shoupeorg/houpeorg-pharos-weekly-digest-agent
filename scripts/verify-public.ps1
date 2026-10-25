$ErrorActionPreference = 'Stop'
$Base = 'https://pharos-weekly-digest-agent.shoupeorg.workers.dev'
$Page = Invoke-WebRequest -UseBasicParsing -Uri $Base -TimeoutSec 30
$Meta = Invoke-RestMethod -Uri "$Base/api/meta" -TimeoutSec 30
$Archive = Invoke-RestMethod -Uri "$Base/api/archive" -TimeoutSec 30
if ($Page.StatusCode -ne 200 -or $Page.Content -notmatch 'Pharos Weekly Digest Agent') { throw 'Public UI assertion failed.' }
if ($Meta.chainId -ne 1672 -or $Meta.engineVersion -ne 'weekly-digest/1.0.2-coverage-proof') { throw 'Public API assertion failed.' }
[pscustomobject]@{ ui = $Page.StatusCode; engine = $Meta.engineVersion; chainId = $Meta.chainId; archiveEntries = $Archive.digests.Count } | ConvertTo-Json
