import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv[2] || "https://pharos-weekly-digest-agent.shoupeorg.workers.dev";
const wallet = "0x197afc201b8d839288d7a7e9a03fb95669e3b0f3";
const capability = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
const headers = { "content-type": "application/json", "x-digest-capability": capability };
const manualLabel = "Coverage-corrected historical example v1.1 [USER-SUPPLIED]";
const scheduledLabel = "Coverage-corrected scheduler example v1.1 [USER-SUPPLIED]";

async function request(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${path} returned HTTP ${response.status}, ${response.headers.get("content-type")}, non-JSON: ${text.slice(0, 300)}`); }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${body.error || text.slice(0, 300)}`);
  return body;
}

async function findPublished(label, trigger = null) {
  const archive = await request("/api/archive");
  for (const item of archive.digests.filter(item => item.label === label)) {
    const digest = await request(`${item.permalink}?format=json`);
    if (!trigger || digest.schedule?.trigger === trigger) return { digest, permalink: item.permalink };
  }
  return null;
}

function assertComplete(digest) {
  if (digest.coverage.status !== "COMPLETE") throw new Error(`${digest.label} remains ${digest.coverage.status}: ${digest.coverage.note}`);
  const current = digest.observations.filter(event => event.timestamp >= digest.periods.current.start && event.timestamp < digest.periods.current.end);
  const previous = digest.observations.filter(event => event.timestamp >= digest.periods.previous.start && event.timestamp < digest.periods.previous.end);
  if (!current.length || !previous.length) throw new Error(`${digest.label} did not preserve meaningful activity in both full periods.`);
  return { currentEvents: current.length, previousEvents: previous.length, topEvents: digest.topEvents.length };
}

await mkdir(new URL("../evidence/", import.meta.url), { recursive: true });
let manual = await findPublished(manualLabel);
if (!manual) manual = await request("/api/manual", { method: "POST", body: JSON.stringify({ wallet, label: manualLabel, cadence: "weekly", weekday: 1, utcHour: 9, utcMinute: 0, manual: { start: "2026-10-12T00:00:00.000Z", end: "2026-10-19T00:00:00.000Z" } }) });
const manualCounts = assertComplete(manual.digest);
await writeFile(new URL("../evidence/live-manual-v1.1.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), base, permalink: manual.permalink, digest: manual.digest }, null, 2));

let scheduled = await findPublished(scheduledLabel, "DEMO SCHEDULE"), state, delivery, saved;
if (!scheduled) {
  saved = await request("/api/subscription", { method: "POST", body: JSON.stringify({ wallet, label: scheduledLabel, cadence: "demo", utcHour: 0, utcMinute: 0 }) });
  await request(`/api/subscription/${saved.id}/start`, { method: "POST" });
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 15000));
    state = await request(`/api/subscription/${saved.id}/state`);
    delivery = state.deliveries?.[0];
    if (delivery) break;
  }
  await request(`/api/subscription/${saved.id}/pause`, { method: "POST" });
  if (!delivery) throw new Error(`Scheduled delivery did not publish within 360 seconds. Last jobs: ${JSON.stringify(state?.jobs?.slice(0, 3) || [])}`);
  scheduled = { digest: await request(`${delivery.permalink}?format=json`), permalink: delivery.permalink };
} else {
  delivery = { permalink: scheduled.permalink, due_at: scheduled.digest.schedule.dueAt, started_at: scheduled.digest.schedule.actualStart, completed_at: scheduled.digest.schedule.completedAt, lateness_ms: scheduled.digest.schedule.latenessMs };
  state = { reusedPublishedDigest: true };
}
const scheduledCounts = assertComplete(scheduled.digest);
await writeFile(new URL("../evidence/live-scheduled-v1.1.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), base, subscriptionId: saved?.id || scheduled.digest.schedule.subscriptionId, state, delivery, digest: scheduled.digest }, null, 2));
const manifest = { version: "1.1", generatedAt: new Date().toISOString(), historicalEvidencePreserved: ["live-manual-v1.json", "live-scheduled-v1.json"], manual: { permalink: manual.permalink, coverage: manual.digest.coverage.status, ...manualCounts }, scheduled: { permalink: delivery.permalink, dueAt: delivery.due_at, startedAt: delivery.started_at, completedAt: delivery.completed_at, latenessMs: delivery.lateness_ms, coverage: scheduled.digest.coverage.status, ...scheduledCounts }, transactionsPerformed: 0 };
await writeFile(new URL("../evidence/manifest-v1.1.json", import.meta.url), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
