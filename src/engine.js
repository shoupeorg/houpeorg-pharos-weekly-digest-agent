const ZERO = "0x0000000000000000000000000000000000000000";
export const ENGINE_VERSION = "weekly-digest/1.0.0";

export function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error("A valid public EVM wallet address is required.");
  return value.toLowerCase();
}

export function completedPeriods(now = new Date(), cadence = "weekly", manual = null) {
  if (manual) {
    const end = new Date(manual.end), start = new Date(manual.start);
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) throw new Error("Invalid historical interval.");
    const duration = end - start;
    return { kind: "MANUAL / HISTORICAL", current: { start: start.toISOString(), end: end.toISOString() }, previous: { start: new Date(start - duration).toISOString(), end: start.toISOString() } };
  }
  const date = new Date(now);
  if (cadence === "daily") {
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), start = new Date(end - 864e5);
    return { kind: "SCHEDULED DAILY", current: { start: start.toISOString(), end: end.toISOString() }, previous: { start: new Date(start - 864e5).toISOString(), end: start.toISOString() } };
  }
  const day = (date.getUTCDay() + 6) % 7, end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day)), start = new Date(end - 7 * 864e5);
  return { kind: "SCHEDULED WEEKLY", current: { start: start.toISOString(), end: end.toISOString() }, previous: { start: new Date(start - 7 * 864e5).toISOString(), end: start.toISOString() } };
}

export function nextRun(config, from = new Date()) {
  const cadence = config.cadence || "weekly", hour = Number(config.utcHour ?? config.utc_hour), minute = Number(config.utcMinute ?? config.utc_minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("UTC time is invalid.");
  const base = new Date(from);
  if (cadence === "demo") return new Date(Math.floor(base.getTime() / 120000) * 120000 + 120000).toISOString();
  if (cadence === "daily") { let result = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute)); if (result <= base) result = new Date(result.getTime() + 864e5); return result.toISOString(); }
  const weekday = Number(config.weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error("Weekday must be 1 (Monday) through 7 (Sunday).");
  const add = (weekday - (base.getUTCDay() || 7) + 7) % 7;
  let result = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + add, hour, minute));
  if (result <= base) result = new Date(result.getTime() + 7 * 864e5);
  return result.toISOString();
}

export function normalizeTransfer(value) {
  const from = normalizeAddress(value.from_address || value.from), to = normalizeAddress(value.to_address || value.to), token = normalizeAddress(value.token_address || value.address), raw = String(value.value_raw ?? value.value ?? value.amount_raw);
  if (!/^\d+$/.test(raw)) throw new Error("Malformed transfer amount.");
  const decimals = value.token_decimals == null ? null : Number(value.token_decimals), transactionHash = String(value.transaction_hash || value.transactionHash).toLowerCase(), logIndex = Number(value.log_index ?? value.logIndex), timestamp = new Date(value.block_timestamp || Number(value.timestamp || value.timeStamp) * 1000);
  if (!/^0x[a-f0-9]{64}$/.test(transactionHash) || !Number.isInteger(logIndex) || !Number.isFinite(+timestamp)) throw new Error("Malformed indexed transfer.");
  return { id: `1672:${transactionHash}:${logIndex}`, observationId: `obs:1672:${transactionHash}:${logIndex}`, transactionHash, logIndex, blockNumber: Number(value.block_number || value.blockNumber), timestamp: timestamp.toISOString(), from, to, token, symbol: String(value.token_symbol || value.symbol || "UNKNOWN"), decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null, amountRaw: raw };
}

export function format(raw, decimals) {
  if (decimals == null) return null;
  const value = BigInt(raw), sign = value < 0n ? "-" : "", digits = (value < 0n ? -value : value).toString().padStart(decimals + 1, "0"), whole = digits.slice(0, -decimals) || "0", fraction = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return `${sign}${fraction ? `${whole}.${fraction}` : whole}`;
}

function aggregate(events, wallet, period) {
  const start = +new Date(period.start), end = +new Date(period.end), seen = new Map(), days = new Set(), transactions = new Set(), tokens = {};
  for (const event of events) {
    const timestamp = +new Date(event.timestamp);
    if (timestamp < start || timestamp >= end || seen.has(event.id)) continue;
    seen.set(event.id, event); transactions.add(event.transactionHash); days.add(event.timestamp.slice(0, 10));
    const row = tokens[event.token] || { token: event.token, symbol: event.symbol, decimals: event.decimals, receivedRaw: 0n, sentRaw: 0n, events: 0, unknownDecimals: event.decimals == null };
    row.events++;
    if (event.from === wallet && event.to === wallet) { /* self-transfer is activity, not flow */ } else if (event.to === wallet) row.receivedRaw += BigInt(event.amountRaw); else if (event.from === wallet) row.sentRaw += BigInt(event.amountRaw);
    tokens[event.token] = row;
  }
  return { events: [...seen.values()], uniqueTransactions: transactions.size, transferEvents: seen.size, activeDays: days.size, tokens: Object.fromEntries(Object.entries(tokens).map(([key, row]) => [key, { ...row, receivedRaw: row.receivedRaw.toString(), sentRaw: row.sentRaw.toString(), netRaw: (row.receivedRaw - row.sentRaw).toString(), received: format(row.receivedRaw, row.decimals), sent: format(row.sentRaw, row.decimals), net: format(row.receivedRaw - row.sentRaw, row.decimals) }])) };
}

function delta(current, previous, known = true) {
  const bigint = typeof current === "bigint", absolute = current - previous, show = value => bigint ? value.toString() : value, zero = bigint ? 0n : 0;
  if (!known) return { current: show(current), previous: show(previous), absolute: null, percentage: null, label: "UNKNOWN" };
  if (current === zero && previous === zero) return { current: show(current), previous: show(previous), absolute: show(zero), percentage: 0, label: "NO CHANGE" };
  if (previous === zero && current > zero) return { current: show(current), previous: show(previous), absolute: show(absolute), percentage: null, label: "NEW ACTIVITY" };
  const percentage = bigint ? Number((absolute * 10000n) / previous) / 100 : Number((absolute * 100 / previous).toFixed(2));
  return { current: show(current), previous: show(previous), absolute: show(absolute), percentage, label: "COMPARABLE" };
}

export function selectTop(events, wallet) {
  const byTransaction = new Map();
  for (const event of events) { const rows = byTransaction.get(event.transactionHash) || []; rows.push(event); byTransaction.set(event.transactionHash, rows); }
  const perToken = new Map();
  for (const logs of byTransaction.values()) for (const event of logs) { const prior = perToken.get(event.token); if (!prior || BigInt(event.amountRaw) > BigInt(prior.amountRaw)) perToken.set(event.token, { ...event, logs }); }
  const candidates = [...perToken.values()].sort((a, b) => a.token.localeCompare(b.token) || (BigInt(a.amountRaw) === BigInt(b.amountRaw) ? 0 : BigInt(a.amountRaw) > BigInt(b.amountRaw) ? -1 : 1));
  const selected = [], used = new Set();
  for (const event of candidates) {
    if (used.has(event.transactionHash)) continue;
    used.add(event.transactionHash);
    selected.push({ transactionHash: event.transactionHash, timestamp: event.timestamp, blockNumber: event.blockNumber, token: event.token, symbol: event.symbol, amountRaw: event.amountRaw, amount: format(event.amountRaw, event.decimals), from: event.from, to: event.to, direction: event.from === ZERO ? "MINT" : event.to === ZERO ? "BURN" : event.from === wallet && event.to === wallet ? "SELF_TRANSFER" : event.to === wallet ? "RECEIVED" : "SENT", why: "Largest observed transfer for this asset in the current period; assets are not ranked against one another.", observationIds: event.logs.map(row => row.observationId) });
    if (selected.length === 3) break;
  }
  return selected;
}

export function buildDigest({ wallet, label = "Public wallet example", periods, events, coverage, generatedAt = new Date().toISOString(), id = crypto.randomUUID() }) {
  wallet = normalizeAddress(wallet);
  const current = aggregate(events, wallet, periods.current), previous = aggregate(events, wallet, periods.previous), comparable = coverage.status === "COMPLETE", tokenKeys = new Set([...Object.keys(current.tokens), ...Object.keys(previous.tokens)]), tokenComparisons = {};
  for (const key of tokenKeys) {
    const a = current.tokens[key] || { receivedRaw: "0", sentRaw: "0", netRaw: "0", symbol: previous.tokens[key].symbol, decimals: previous.tokens[key].decimals }, b = previous.tokens[key] || { receivedRaw: "0", sentRaw: "0", netRaw: "0", symbol: a.symbol, decimals: a.decimals };
    tokenComparisons[key] = { token: key, symbol: a.symbol, decimals: a.decimals, received: delta(BigInt(a.receivedRaw), BigInt(b.receivedRaw), comparable && a.decimals != null), sent: delta(BigInt(a.sentRaw), BigInt(b.sentRaw), comparable && a.decimals != null), net: { currentRaw: a.netRaw, previousRaw: b.netRaw, absoluteRaw: comparable ? (BigInt(a.netRaw) - BigInt(b.netRaw)).toString() : null, label: comparable && a.decimals != null ? "COMPARABLE" : "UNKNOWN" } };
  }
  return { id, engineVersion: ENGINE_VERSION, wallet, label, labelSource: "USER_SUPPLIED", kind: periods.kind, periods, generatedAt, publishedAt: null, coverage, metrics: { uniqueTransactions: delta(current.uniqueTransactions, previous.uniqueTransactions, comparable), transferEvents: delta(current.transferEvents, previous.transferEvents, comparable), activeDays: delta(current.activeDays, previous.activeDays, comparable), tokens: tokenComparisons }, topEvents: selectTop(current.events, wallet), observations: events, limitations: ["Standard ERC-20 Transfer events only.", "Token amounts are never combined across assets.", "Labels are user-supplied unless a source is shown.", "Incomplete indexer coverage makes comparisons LIMITED or NOT COMPARABLE."] };
}

export function digestMarkdown(digest) {
  const events = digest.topEvents.length ? digest.topEvents.map((event, index) => `${index + 1}. ${event.direction} ${event.amount ?? "UNKNOWN"} ${event.symbol} — ${event.why} [${event.transactionHash}](https://pharosscan.xyz/tx/${event.transactionHash})`).join("\n") : "Fewer than one qualifying event was observed; no events were invented.";
  return `# Weekly Digest: ${digest.label}\n\n**Wallet:** ${digest.wallet}\n\n**Current:** ${digest.periods.current.start} to ${digest.periods.current.end} (exclusive)  \n**Previous:** ${digest.periods.previous.start} to ${digest.periods.previous.end} (exclusive)\n\n**Coverage:** ${digest.coverage.status} — ${digest.coverage.note || ""}\n\n## Headline metrics\n\n- Unique transactions: ${digest.metrics.uniqueTransactions.current} (${digest.metrics.uniqueTransactions.label})\n- Transfer events: ${digest.metrics.transferEvents.current} (${digest.metrics.transferEvents.label})\n- Active days: ${digest.metrics.activeDays.current} (${digest.metrics.activeDays.label})\n\n## Notable transactions\n\n${events}\n\nGenerated ${digest.generatedAt}; published ${digest.publishedAt || "not yet"}.\n`;
}
