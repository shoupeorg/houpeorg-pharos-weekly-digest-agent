# Architecture

```mermaid
flowchart LR
  U[Reviewer] -->|save/start/pause| W[Cloudflare Worker]
  C[Cloudflare Cron every minute] --> W
  W --> D[(D1 subscriptions, jobs, digests, deliveries)]
  W -->|chain ID and boundary blocks| R[Pharos JSON-RPC]
  W -->|bounded ERC-20 history| I[SocialScan public explorer API]
  W --> P[Immutable public digest permalink]
  P --> J[JSON export]
  P --> M[Markdown export]
```

The scheduler persists the period job before execution. A unique idempotency key prevents duplicate period jobs, a conditional lease prevents concurrent execution, and expired/failed jobs are retried. Publication and delivery records are unique by job. Schedules advance independently because their persisted jobs remain recoverable.

The official Pharos Chain MCP was used for foundation capability and chain verification. Production uses explicitly named JSON-RPC and explorer transports because a Cloudflare Worker cannot assume an interactive MCP session.
