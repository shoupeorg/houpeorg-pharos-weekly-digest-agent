# Status

Updated: 2026-10-25 UTC

## Completed

- Official Pharos Chain MCP schemas inspected; chain ID 1672 verified read-only.
- Shared period, exact arithmetic, deduplication, comparison, selection, and Markdown engine implemented.
- SocialScan pagination and JSON-RPC timestamp/block boundary source implemented with fail-closed coverage.
- Cloudflare Worker, D1 schema, Cron dispatch, idempotent jobs, conditional leases, recovery, archive, exports, and capability-isolated schedule controls implemented.
- English-only responsive retro Pharos UI implemented.
- Root skill, CLI, README, and architecture documentation added.

## Pending

- Install from the existing package lock/cache, run tests and production build.
- Capture and version a genuine public manual digest and a scheduler-triggered delivery if the deployed indexer transport succeeds.
- Initialize/publish GitHub repository, create/reuse D1, migrate, deploy, and visually verify desktop/mobile.

## Known external risk

The SocialScan public address endpoint returned HTTP 403 from the local sandbox. Deployment must prove whether the Worker egress can access it. A 403 will be reported as a blocker and will not be mislabeled as empty or complete history.

## 2026-10-26 exact-amount correction

- Deployment and Cron installation succeeded before evidence capture.
- The first manual capture failed because SocialScan returned `value: "190.859681"` with `token_info.decimals: 6`; the old normalizer required an integer in every amount field.
- Engine `weekly-digest/1.0.1-exact-indexer-amounts` converts human-decimal strings to raw integers using string operations and `BigInt`, while raw decimal/hex integer fields remain exact.
- Invalid precision is now `SOURCE_DATA_FAILURE`/HTTP 502 with transaction and log identity, never a user-input error or an empty event.
- 19/19 tests and the production build pass locally. Deployment, manual evidence, genuine Cron evidence, publication, and public verification remain to be resumed with `scripts/resume-after-transfer-fix.ps1` in the authenticated normal terminal.
