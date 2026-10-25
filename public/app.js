const $ = selector => document.querySelector(selector);
const capability = localStorage.getItem("pharos-digest-cap") || crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
localStorage.setItem("pharos-digest-cap", capability);
let subscriptionId = localStorage.getItem("pharos-digest-sub"), timer = null;
const headers = { "content-type": "application/json", "x-digest-capability": capability };

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers, ...options.headers } }), text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${path}: HTTP ${response.status} returned non-JSON`); }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; }
function status(text) { $("#status").textContent = text; }
function form() { return { wallet: $("#wallet").value, label: $("#label").value, cadence: $("#cadence").value, weekday: Number($("#weekday").value), utcHour: Number($("#hour").value), utcMinute: Number($("#minute").value) }; }

function render(digest) {
  const base = `/digest/${digest.id}`;
  $("#json-export").href = `${base}?format=json`; $("#md-export").href = `${base}?format=md`; $("#exports").hidden = false;
  $("#periods").textContent = `Current ${digest.periods.current.start} → ${digest.periods.current.end} (exclusive) | Previous ${digest.periods.previous.start} → ${digest.periods.previous.end} (exclusive) | ${digest.kind}`;
  const metrics = $("#metrics"); metrics.replaceChildren();
  for (const [name, value] of Object.entries({ "Unique transactions": digest.metrics.uniqueTransactions, "Transfer events": digest.metrics.transferEvents, "Active days": digest.metrics.activeDays })) {
    const card = element("div", "card"); card.append(element("b", "", value.current), element("span", "", `${name} · previous ${value.previous} · change ${value.absolute ?? "UNKNOWN"} · ${value.percentage == null ? "percentage unavailable" : value.percentage + "%"} · ${value.label}`)); metrics.append(card);
  }
  const tokens = $("#tokens"); tokens.replaceChildren();
  for (const value of Object.values(digest.metrics.tokens)) tokens.append(element("div", "token-row", `${value.symbol}: received ${value.received.current} raw vs ${value.received.previous} · sent ${value.sent.current} raw vs ${value.sent.previous} · net ${value.net.currentRaw} raw vs ${value.net.previousRaw} · ${value.net.label}`));
  const events = $("#events"); events.replaceChildren();
  if (!digest.topEvents.length) events.append(element("div", "empty", "Fewer than one qualifying transaction was observed. No events were invented."));
  digest.topEvents.forEach((event, index) => {
    const article = element("article", "event"), link = element("a", "", event.transactionHash);
    link.href = `https://pharosscan.xyz/tx/${event.transactionHash}`; link.target = "_blank"; link.rel = "noopener noreferrer";
    article.append(element("span", "tag", `NOTABLE ${index + 1}`), element("h3", "", `${event.direction} · ${event.amount ?? "UNKNOWN"} ${event.symbol}`), element("p", "", `${event.from} → ${event.to}`), element("p", "", event.why), link, element("p", "", `Block ${event.blockNumber} · ${event.timestamp} · evidence ${event.observationIds.join(", ")}`)); events.append(article);
  });
  $("#coverage").textContent = `${digest.coverage.status}: ${digest.coverage.note} Transport: ${digest.coverage.transport}. Pages: ${digest.coverage.pages}; rows ${digest.coverage.uniqueRows ?? digest.coverage.scannedRows ?? "UNKNOWN"}/${digest.coverage.totalReported ?? "UNKNOWN"}; observed ${digest.coverage.oldestObservedAt ?? "UNKNOWN"} → ${digest.coverage.newestObservedAt ?? "UNKNOWN"}. Boundaries: ${JSON.stringify(digest.coverage.blockBoundaries)}.`;
}

async function archive() {
  const body = await api("/api/archive"), root = $("#archive"); root.replaceChildren();
  for (const digest of body.digests) { const row = element("div", "archive-row"), link = element("a", "button", `${digest.label} · ${digest.coverage}`); link.href = digest.permalink; row.append(link, element("span", "", ` ${digest.period.start.slice(0, 10)} → ${digest.period.end.slice(0, 10)} · ${digest.publishedAt}`)); root.append(row); }
  if (!body.digests.length) root.append(element("div", "empty", "No published digests yet."));
}
async function state() {
  if (!subscriptionId) return;
  const body = await api(`/api/subscription/${subscriptionId}/state`), subscription = body.subscription;
  $("#schedule").textContent = `${subscription.status} · ${subscription.cadence.toUpperCase()} · next scheduled run ${subscription.next_due_at || "not set"} UTC · jobs ${body.jobs.length} · deliveries ${body.deliveries.length}`;
  clearInterval(timer); if (subscription.status === "ACTIVE") timer = setInterval(state, 15000);
}

$("#example").onclick = () => { $("#wallet").value = "0x197afc201b8d839288d7a7e9a03fb95669e3b0f3"; $("#label").value = "Coverage-verified public example [USER-SUPPLIED]"; status("Coverage-verified public example loaded. Choose explicit historical dates or use the completed-week default."); };
$("#generate").onclick = async () => { try { status("Retrieving both intervals and resolving exact block boundaries…"); const body = form(), start = $("#start").value, end = $("#end").value; if (start && end) body.manual = { start: `${start}T00:00:00.000Z`, end: `${end}T00:00:00.000Z` }; const result = await api("/api/manual", { method: "POST", body: JSON.stringify(body) }); render(result.digest); status(`Published and retrievable: ${location.origin}${result.permalink}`); await archive(); } catch (error) { status(error.message); } };
$("#save").onclick = async () => { try { const result = await api("/api/subscription", { method: "POST", body: JSON.stringify({ ...form(), id: subscriptionId }) }); subscriptionId = result.id; localStorage.setItem("pharos-digest-sub", result.id); await state(); status("Schedule saved PAUSED. Configuration controls the next computed due time."); } catch (error) { status(error.message); } };
for (const [id, action] of [["start-schedule", "start"], ["pause", "pause"]]) $("#" + id).onclick = async () => { try { if (!subscriptionId) throw new Error("Save a schedule first."); await api(`/api/subscription/${subscriptionId}/${action}`, { method: "POST" }); await state(); status(action === "pause" ? "Schedule paused; history preserved." : "Schedule active; browser closure does not stop Cloudflare Cron."); } catch (error) { status(error.message); } };
$("#refresh").onclick = archive;

async function init() {
  const meta = await api("/api/meta"); $("#engine").textContent = `${meta.engineVersion} · chain ${meta.chainId} · ${meta.scheduler}`;
  const path = location.pathname.match(/^\/digest\/([^/]+)/); if (path) { const response = await fetch(`/digest/${path[1]}?format=json`); if (response.ok) render(await response.json()); }
  await archive(); await state(); status("Ready. Public data only; no signing or transactions.");
}
init().catch(error => status(error.message));
