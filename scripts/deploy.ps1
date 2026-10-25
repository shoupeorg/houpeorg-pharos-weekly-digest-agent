$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Project
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }
npx wrangler d1 migrations apply pharos-weekly-digest-agent --remote
if ($LASTEXITCODE -ne 0) { throw "D1 migration failed with exit code $LASTEXITCODE" }
npx wrangler deploy --no-bundle
if ($LASTEXITCODE -ne 0) { throw "Deployment failed with exit code $LASTEXITCODE" }
