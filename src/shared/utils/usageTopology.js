export const TOPOLOGY_RECENT_WINDOW_MS = 10 * 60 * 1000;

function getTimestampMs(timestamp) {
  if (!timestamp) return 0;
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function getRecentProvidersFromRequests(requests = [], now = Date.now(), windowMs = TOPOLOGY_RECENT_WINDOW_MS, limit = 4) {
  if (!Array.isArray(requests) || requests.length === 0) return [];

  const cutoff = now - windowMs;
  const unique = [];
  const seen = new Set();

  for (const req of requests) {
    const provider = req?.provider?.toLowerCase?.();
    const timestamp = getTimestampMs(req?.timestamp);
    if (!provider || !timestamp || timestamp < cutoff || seen.has(provider)) continue;
    seen.add(provider);
    unique.push(provider);
    if (unique.length >= limit) break;
  }

  return unique;
}

export function getRecentLastProvider(requests = [], now = Date.now(), windowMs = TOPOLOGY_RECENT_WINDOW_MS) {
  if (!Array.isArray(requests) || requests.length === 0) return "";

  const latest = requests[0];
  const provider = latest?.provider || "";
  const timestamp = getTimestampMs(latest?.timestamp);
  if (!provider || !timestamp || now - timestamp > windowMs) return "";
  return provider;
}
