import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv[2] || "https://pharos-weekly-digest-agent.shoupeorg.workers.dev";
const wallet = "0x15ddce897d76ac39c188ade4d353711a60395315";
const capability = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
const headers = { "content-type": "application/json", "x-digest-capability": capability };
async function request(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${path} returned HTTP ${response.status}, ${response.headers.get("content-type")}, non-JSON: ${text.slice(0, 300)}`); }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${body.error || text.slice(0, 300)}`);
  return body;
}

await mkdir(new URL("../evidence/", import.meta.url), { recursive: true });
const manualLabel = "Verified public weekly example [USER-SUPPLIED]", scheduledLabel = "Verified scheduler example [USER-SUPPLIED]";
async function findPublished(label, trigger = null) {
  const archive = await request("/api/archive");
  for (const item of archive.digests.filter(item => item.label === label)) {
    const digest = await request(`${item.permalink}?format=json`);
    if (!trigger || digest.schedule?.trigger === trigger) return { digest, permalink: item.permalink };
  }
  return null;
}
let manual = null;
for (let attempt = 0; attempt < 6 && !manual; attempt++) {
  manual = await findPublished(manualLabel);
  if (!manual) await new Promise(resolve => setTimeout(resolve, 10000));
}
if (!manual) manual = await request("/api/manual", { method: "POST", body: JSON.stringify({ wallet, label: manualLabel, cadence: "weekly", weekday: 1, utcHour: 9, utcMinute: 0 }) });
await writeFile(new URL("../evidence/live-manual-v1.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), base, permalink: manual.permalink, digest: manual.digest }, null, 2));

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
await writeFile(new URL("../evidence/live-scheduled-v1.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), base, subscriptionId: saved?.id || scheduled.digest.schedule.subscriptionId, state, delivery, digest: scheduled.digest }, null, 2));
await writeFile(new URL("../evidence/manifest-v1.json", import.meta.url), JSON.stringify({ version: "1.0", generatedAt: new Date().toISOString(), manual: { permalink: manual.permalink, coverage: manual.digest.coverage.status }, scheduled: { permalink: delivery.permalink, dueAt: delivery.due_at, startedAt: delivery.started_at, completedAt: delivery.completed_at, latenessMs: delivery.lateness_ms, coverage: scheduled.digest.coverage.status }, transactionsPerformed: 0 }, null, 2));
console.log(JSON.stringify({ manual: manual.permalink, scheduled: delivery.permalink, schedulerLatenessMs: delivery.lateness_ms, coverage: [manual.digest.coverage.status, scheduled.digest.coverage.status] }, null, 2));
