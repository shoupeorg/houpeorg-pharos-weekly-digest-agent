---
name: pharos-weekly-digest
description: Create an evidence-backed comparison of a public Pharos wallet's ERC-20 activity across two completed UTC periods, or configure a durable daily or weekly digest schedule. Use when asked what changed for a wallet, for a weekly activity briefing, or to schedule a read-only digest.
---

# Pharos Weekly Digest

1. Require one public EVM wallet address. Treat any label as user-supplied unless a source proves it.
2. Choose two adjacent, equal-duration, completed UTC periods. Weekly periods are Monday 00:00 UTC to Monday 00:00 UTC; daily periods are UTC days. An explicit historical interval is start-inclusive and end-exclusive.
3. Verify RPC chain ID 1672. Resolve each timestamp boundary to the first block at or after it.
4. Retrieve standard ERC-20 `Transfer` activity through the configured indexer with bounded pagination. Never turn a failed, malformed, or capped response into empty complete activity.
5. Deduplicate by chain, transaction hash, and log index. Use integer token amounts. Never sum unlike assets.
6. Compare transaction count, event count, active days, and per-token received/sent/net values. Mark comparisons UNKNOWN when coverage or decimals are inadequate.
7. Select at most three distinct transactions, taking the largest observed transfer per asset without ranking raw quantities across assets. Explain this selection rule.
8. Publish the digest with provenance, coverage, limitations, and direct JSON/Markdown exports. For scheduled work, record due/start/completion times and lateness.
9. Do not request keys, connect wallets, sign, broadcast, deploy contracts, or spend funds.

The web application is the deterministic companion and scheduler for this skill. It uses Cloudflare Cron plus D1 so closing the browser does not stop an active schedule.
