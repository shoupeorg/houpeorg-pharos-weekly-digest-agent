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

## 2026-10-26 coverage correction

- Deployment and genuine Cron publication succeeded; historical v1 manual/scheduled reports remain `PARTIAL` and are preserved.
- Exact gap: each v1 report scanned 30 pages / 1,500 records, but the oldest observed record was still after the requested 2026-10-05 through 2026-10-19 intervals. No target-period observations were collected, so comparisons and top events are `UNKNOWN`, not zero.
- The public SocialScan route exposes deeper pagination but a 10,000-record display ceiling and no public date/block filter. The original wallet has more than 57,000 records, so the two periods cannot be proven complete through that route.
- A bounded check of previously recorded real addresses found `0x197afc201b8d839288d7a7e9a03fb95669e3b0f3`: 59 total transfer records, full history back to 2026-05-19, and one transaction in each requested full week.
- Engine `weekly-digest/1.0.2-coverage-proof` records source depth and deduplicates transaction-hash/log-index observations while failing closed at a cap.
- Pending: run tests/build, deploy the code/assets once, capture versioned COMPLETE manual and genuine scheduled evidence, publish to the actual repository, and verify public outputs.

## Coverage correction verified

- Versioned v1.1 manual and genuine scheduler reports prove COMPLETE source coverage for both full periods.
- Historical v1 PARTIAL reports remain unchanged and documented as non-comparable.
- Public UI, archive, JSON/Markdown exports, scheduler provenance, and evidence assets were verified after deployment.
