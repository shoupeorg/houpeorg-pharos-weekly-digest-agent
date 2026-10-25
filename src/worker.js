import { buildDigest, completedPeriods, digestMarkdown, nextRun, normalizeAddress } from "./engine.js";
import { collect } from "./source.js";

const now = () => new Date().toISOString();
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }
});
const hash = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, "0")).join("");

function capability(request) {
  const value = request.headers.get("x-digest-capability") || "";
  if (!/^[a-zA-Z0-9_-]{24,100}$/.test(value)) throw new Error("A scoped visitor capability is required.");
  return value;
}

async function owned(request, env, id) {
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(id).first();
  if (!row || row.capability_hash !== await hash(capability(request))) throw new Error("Subscription not found for this capability.");
  return row;
}

function scheduleConfig(body) {
  const cadence = ["daily", "weekly", "demo"].includes(body.cadence) ? body.cadence : "weekly";
  return { wallet: normalizeAddress(body.wallet), label: String(body.label || "Public wallet example").slice(0, 80), cadence, weekday: cadence === "weekly" ? Number(body.weekday || 1) : null, utcHour: Number(body.utcHour ?? 9), utcMinute: Number(body.utcMinute ?? 0) };
}

async function generate(env, { subscription, periods, kind, dueAt, jobId }) {
  const started = now(), lease = new Date(Date.now() + 120000).toISOString();
  const claim = await env.DB.prepare("UPDATE jobs SET status='RUNNING',started_at=?,lease_until=?,error=NULL WHERE id=? AND (status IN ('PENDING','FAILED') OR (status='RUNNING' AND lease_until<?))").bind(started, lease, jobId, started).run();
  if (Number(claim.meta?.changes || 0) !== 1) return null;
  try {
    const source = await collect({ rpcUrl: env.RPC_URL, indexerUrl: env.INDEXER_URL, wallet: subscription.wallet, periods, maxPages: Number(env.MAX_INDEXER_PAGES), pageSize: Number(env.PAGE_SIZE) });
    const digest = buildDigest({ wallet: subscription.wallet, label: subscription.label, periods, events: source.events, coverage: source.coverage });
    const published = now();
    digest.publishedAt = published;
    digest.schedule = { subscriptionId: subscription.id, jobId, dueAt, actualStart: started, completedAt: published, latenessMs: Math.max(0, Date.parse(started) - Date.parse(dueAt)), trigger: kind };
    const permalink = `/digest/${digest.id}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO digests(id,subscription_id,job_id,digest_json,published_at,permalink) VALUES(?,?,?,?,?,?)").bind(digest.id, subscription.id, jobId, JSON.stringify(digest), published, permalink),
      env.DB.prepare("INSERT INTO deliveries(id,subscription_id,job_id,digest_id,due_at,started_at,completed_at,published_at,lateness_ms,permalink) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), subscription.id, jobId, digest.id, dueAt, started, published, published, digest.schedule.latenessMs, permalink),
      env.DB.prepare("UPDATE jobs SET status='PUBLISHED',completed_at=?,lease_until=NULL WHERE id=? AND status='RUNNING'").bind(published, jobId)
    ]);
    return digest;
  } catch (error) {
    await env.DB.prepare("UPDATE jobs SET status='FAILED',error=?,completed_at=?,lease_until=NULL WHERE id=? AND status='RUNNING'").bind(String(error.message).slice(0, 500), now(), jobId).run();
    throw error;
  }
}

async function enqueue(env, subscription, periods, kind, dueAt) {
  const key = `${subscription.id}:${periods.current.start}:${periods.current.end}:${kind}`;
  await env.DB.prepare("INSERT OR IGNORE INTO jobs(id,subscription_id,idempotency_key,kind,period_start,period_end,comparison_start,status,due_at,created_at) VALUES(?,?,?,?,?,?,?,'PENDING',?,?)").bind(crypto.randomUUID(), subscription.id, key, kind, periods.current.start, periods.current.end, periods.previous.start, dueAt, now()).run();
  return env.DB.prepare("SELECT * FROM jobs WHERE idempotency_key=?").bind(key).first();
}

async function runSavedJob(env, job, trigger = "RECOVERY") {
  const subscription = await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(job.subscription_id).first();
  if (!subscription) return null;
  const periods = { kind: job.kind, current: { start: job.period_start, end: job.period_end }, previous: { start: job.comparison_start, end: job.period_start } };
  return generate(env, { subscription, periods, kind: trigger, dueAt: job.due_at, jobId: job.id });
}

async function dispatch(env) {
  const stamp = now();
  const retries = (await env.DB.prepare("SELECT * FROM jobs WHERE status='FAILED' OR (status='RUNNING' AND lease_until<?) ORDER BY created_at LIMIT 5").bind(stamp).all()).results;
  for (const job of retries) await runSavedJob(env, job).catch(() => {});
  const due = (await env.DB.prepare("SELECT * FROM subscriptions WHERE status='ACTIVE' AND next_due_at<=? ORDER BY next_due_at LIMIT 10").bind(stamp).all()).results;
  for (const subscription of due) {
    const reportCadence = subscription.cadence === "demo" ? "weekly" : subscription.cadence;
    const periods = completedPeriods(new Date(subscription.next_due_at), reportCadence), kind = subscription.cadence === "demo" ? "DEMO SCHEDULE" : "CRON";
    const job = await enqueue(env, subscription, periods, kind, subscription.next_due_at), next = nextRun(subscription, new Date(subscription.next_due_at));
    await env.DB.prepare("UPDATE subscriptions SET last_due_at=?,next_due_at=?,updated_at=? WHERE id=? AND next_due_at=?").bind(subscription.next_due_at, next, now(), subscription.id, subscription.next_due_at).run();
    if (["PENDING", "FAILED"].includes(job.status)) await runSavedJob(env, job, kind).catch(() => {});
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/digest/")) {
    const id = url.pathname.split("/")[2], row = await env.DB.prepare("SELECT digest_json FROM digests WHERE id=?").bind(id).first();
    if (!row) return new Response("Digest not found", { status: 404 });
    const digest = JSON.parse(row.digest_json);
    if (url.searchParams.get("format") === "json") return json(digest);
    if (url.searchParams.get("format") === "md") return new Response(digestMarkdown(digest), { headers: { "content-type": "text/markdown; charset=utf-8" } });
    return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
  }
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  try {
    if (url.pathname === "/api/meta") return json({ engineVersion: env.ENGINE_VERSION, chainId: Number(env.CHAIN_ID), scheduler: "Cloudflare Cron every minute", reporting: "completed UTC calendar periods", transport: "SocialScan public explorer API + Pharos JSON-RPC" });
    if (url.pathname === "/api/archive") {
      const rows = (await env.DB.prepare("SELECT id,published_at,permalink,digest_json FROM digests ORDER BY published_at DESC LIMIT 30").all()).results;
      return json({ digests: rows.map(row => { const digest = JSON.parse(row.digest_json); return { id: row.id, publishedAt: row.published_at, permalink: row.permalink, label: digest.label, period: digest.periods.current, coverage: digest.coverage.status }; }) });
    }
    const cap = capability(request);
    if (url.pathname === "/api/subscription" && request.method === "POST") {
      const body = await request.json(), config = scheduleConfig(body), id = String(body.id || crypto.randomUUID()), next = nextRun(config);
      const write = await env.DB.prepare("INSERT INTO subscriptions(id,capability_hash,wallet,label,cadence,weekday,utc_hour,utc_minute,status,next_due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET wallet=excluded.wallet,label=excluded.label,cadence=excluded.cadence,weekday=excluded.weekday,utc_hour=excluded.utc_hour,utc_minute=excluded.utc_minute,next_due_at=excluded.next_due_at,updated_at=excluded.updated_at WHERE capability_hash=excluded.capability_hash").bind(id, await hash(cap), config.wallet, config.label, config.cadence, config.weekday, config.utcHour, config.utcMinute, "PAUSED", next, now(), now()).run();
      if (Number(write.meta?.changes || 0) !== 1) throw new Error("Schedule update was not authorized.");
      return json({ id, ...config, status: "PAUSED", nextDueAt: next });
    }
    if (/^\/api\/subscription\/[^/]+\/state$/.test(url.pathname)) {
      const id = url.pathname.split("/")[3], subscription = await owned(request, env, id);
      const jobs = (await env.DB.prepare("SELECT * FROM jobs WHERE subscription_id=? ORDER BY created_at DESC LIMIT 20").bind(id).all()).results, deliveries = (await env.DB.prepare("SELECT * FROM deliveries WHERE subscription_id=? ORDER BY published_at DESC LIMIT 20").bind(id).all()).results;
      return json({ subscription, jobs, deliveries });
    }
    if (/^\/api\/subscription\/[^/]+\/(start|pause|resume)$/.test(url.pathname) && request.method === "POST") {
      const parts = url.pathname.split("/"), id = parts[3], action = parts[4], subscription = await owned(request, env, id), status = action === "pause" ? "PAUSED" : "ACTIVE";
      if (status === "ACTIVE" && subscription.status !== "ACTIVE") { const active = await env.DB.prepare("SELECT COUNT(*) n FROM subscriptions WHERE status='ACTIVE'").first(); if (Number(active.n) >= Number(env.MAX_ACTIVE_SCHEDULES)) throw new Error("Global active schedule limit reached."); }
      const next = action === "pause" ? subscription.next_due_at : nextRun(subscription);
      await env.DB.prepare("UPDATE subscriptions SET status=?,next_due_at=?,updated_at=? WHERE id=?").bind(status, next, now(), id).run();
      return json({ id, status, nextDueAt: next });
    }
    if (url.pathname === "/api/manual" && request.method === "POST") {
      const body = await request.json(), config = scheduleConfig(body), id = crypto.randomUUID(), stamp = now(), subscription = { id, wallet: config.wallet, label: config.label, cadence: "manual" };
      await env.DB.prepare("INSERT INTO subscriptions(id,capability_hash,wallet,label,cadence,weekday,utc_hour,utc_minute,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id, await hash(cap), config.wallet, config.label, "manual", null, 0, 0, "PAUSED", stamp, stamp).run();
      const periods = completedPeriods(new Date(), "weekly", body.manual), job = await enqueue(env, subscription, periods, "MANUAL / HISTORICAL", stamp), digest = await generate(env, { subscription, periods, kind: "MANUAL / HISTORICAL", dueAt: stamp, jobId: job.id });
      if (!digest) throw new Error("Digest job is already running or published.");
      return json({ digest, permalink: `/digest/${digest.id}` });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) { return json({ error: error.message, code: error.code || "REQUEST_FAILED" }, error.status || 400); }
}

export default { fetch: route, scheduled: (_event, env, context) => context.waitUntil(dispatch(env)) };
export { route, dispatch, enqueue, generate };
