# Pharos Weekly Digest Agent

An English-only, read-only Pharos Pacific Mainnet agent that compares two completed UTC periods, explains up to three notable ERC-20 transactions, publishes permanent digest pages, and runs daily or weekly without an open browser.

## What it does

- Accepts any public wallet and a clearly user-supplied label.
- Compares current and previous completed daily/weekly periods or an explicit equal-duration historical pair.
- Reports unique transactions, transfer events, active days, and exact per-token received/sent/net values.
- Publishes a public archive plus JSON and Markdown exports.
- Supports `Weekly`, `Daily`, and a clearly labeled two-minute `DEMO SCHEDULE`, with pause and resume.
- Persists schedules, idempotent jobs, execution leases, delivery timestamps, and lateness in Cloudflare D1.

## Evidence and arithmetic

The source is standard ERC-20 `Transfer` activity returned by the configured SocialScan public explorer endpoint. Pharos JSON-RPC verifies chain ID 1672 and maps UTC timestamps to exact block boundaries by binary search. Every observation is identified by `chainId:transactionHash:logIndex`; duplicate records and self-transfers do not inflate token flow. Amounts remain decimal strings/`BigInt` until display, and assets are never combined.

Coverage is `COMPLETE` only when pagination reaches the requested interval boundary or exhausts the source-reported wallet history. Reports retain requested boundaries, page count, raw/unique rows scanned, source total, and oldest/newest observed timestamps. A configured page cap, malformed response, timeout, or HTTP error is never interpreted as zero activity. Percent changes use an explicit `NEW ACTIVITY` state when the prior value is zero and `NO CHANGE` when both are zero.

The version-1 evidence for the high-volume wallet is intentionally preserved as historical `PARTIAL` evidence: 1,500 records still ended after the requested periods, so its comparison and top events are unknown. Version 1.1 uses a previously recorded real public wallet whose 59-record history is exhaustible within the bounded pagination budget and contains activity in both full periods.

## Run locally

```powershell
npm install
npm test
npm run build
npx wrangler dev
```

`npm run cli -- periods weekly` prints the current pair of completed UTC periods. The deployed application requires a D1 database configured in `wrangler.jsonc` and migration `0001_initial.sql`.

## Scheduler behavior

Saving a schedule leaves it `PAUSED`. `Start / Resume Schedule` computes a fresh next run; `Pause Schedule` retains history. Editing the configuration recomputes the next due time and returns the schedule to `PAUSED`. Cloudflare Cron checks due schedules every minute. The two-minute demo cadence accelerates triggering but still reports the last completed weekly period so comparison semantics do not change.

## Limits

- ERC-20 `Transfer` events only; native/internal calls, swaps, approvals, intent, and complete account history are outside scope.
- Labels are user-supplied unless provenance says otherwise.
- The indexer is an external dependency. If it blocks the Worker or cannot prove interval coverage, the digest fails or reports partial coverage.
- Explorer links are secondary conveniences; the digest retains saved event evidence.
- No keys, wallet connection, signing, transactions, contracts, or spending.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SKILL.md](SKILL.md).

Public repository: https://github.com/shoupeorg/shoupeorg-pharos-weekly-digest-agent
