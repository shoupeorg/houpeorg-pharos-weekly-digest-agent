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
const manual = await request("/api/manual", { method: "POST", body: JSON.stringify({ wallet, label: "Verified public weekly example [USER-SUPPLIED]", cadence: "weekly", weekday: 1, utcHour: 9, utcMinute: 0 }) });
await writeFile(new URL("../evidence/live-manual-v1.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), base, permalink: manual.permalink, digest: manual.digest }, null, 2));

const saved = await request("/api/subscription", { method: "POST", body: JSON.stringify({ wallet, label: "Verified scheduler example [USER-SUPPLIED]", cadence: "demo", utcHour: 0, utcMinute: 0 }) });
await request(`/api/subscription/${saved.id}/start`, { method: "POST" });
let state, delivery;
for (let attempt = 0; attempt < 24; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 15000));
  state = await request(`/api/subscription/${saved.id}/state`);
  delivery = state.deliveries?.[0];
  if (delivery) break;
}
await request(`/api/subscription/${saved.id}/pause`, { method: "POST" });
if (!delivery) throw new Error(`Scheduled delivery did not publish within 360 seconds. Last jobs: ${JSON.stringify(state?.jobs?.slice(0, 3) || [])}`);
const scheduledDigest = await request(`${delivery.permalink}?format=json`);
await writeFile(new URL("../evidence/live-scheduled-v1.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), base, subscriptionId: saved.id, state, delivery, digest: scheduledDigest }, null, 2));
await writeFile(new URL("../evidence/manifest-v1.json", import.meta.url), JSON.stringify({ version: "1.0", generatedAt: new Date().toISOString(), manual: { permalink: manual.permalink, coverage: manual.digest.coverage.status }, scheduled: { permalink: delivery.permalink, dueAt: delivery.due_at, startedAt: delivery.started_at, completedAt: delivery.completed_at, latenessMs: delivery.lateness_ms, coverage: scheduledDigest.coverage.status }, transactionsPerformed: 0 }, null, 2));
console.log(JSON.stringify({ manual: manual.permalink, scheduled: delivery.permalink, schedulerLatenessMs: delivery.lateness_ms, coverage: [manual.digest.coverage.status, scheduledDigest.coverage.status] }, null, 2));
