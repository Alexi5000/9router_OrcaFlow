import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch } from "undici";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
]) blocked.addSubnet(address, prefix, "ipv6");

export class ProviderUrlError extends Error {}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && /^[23]/i.test(address) && !blocked.check(address, "ipv6");
}

async function resolveAddresses(hostname) {
  let timer;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS request timeout")), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function validateProvider(baseUrl, apiKey, type, modelId = null) {
  let url;
  try {
    if (typeof baseUrl !== "string" || typeof apiKey !== "string") throw new Error();
    url = new URL(baseUrl.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
  } catch {
    throw new ProviderUrlError("Use an HTTP(S) provider URL without credentials, query, or fragment");
  }

  const allowedOrigins = (process.env.PROVIDER_VALIDATION_ALLOWED_ORIGINS || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  const allowPrivate = allowedOrigins.includes(url.origin);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveAddresses(hostname);
  if (!addresses.length || (!allowPrivate && addresses.some(({ address }) => !isPublicAddress(address)))) {
    throw new ProviderUrlError("Provider must use a public address; explicitly allow trusted local origins on the server");
  }

  let path = url.pathname.replace(/\/$/, "");
  if (type === "anthropic-compatible" && path.endsWith("/messages")) path = path.slice(0, -9);
  url.pathname = path + "/models";

  const dispatcher = new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        const matching = options.family ? addresses.filter(item => item.family === options.family) : addresses;
        if (!matching.length) {
          callback(new Error("Provider has no address for the requested family"));
          return;
        }
        const selected = matching[0];
        callback(null, options.all ? matching : selected.address, selected.family);
      },
    },
  });
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (type === "anthropic-compatible") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }

  const send = (endpoint, body = null) => {
    const target = new URL(url);
    target.pathname = path + endpoint;
    return fetch(target, {
      method: body ? "POST" : "GET",
      headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error", signal: AbortSignal.timeout(10000), dispatcher,
    });
  };
  try {
    if (type === "custom-embedding") {
      if (typeof modelId !== "string" || !modelId.trim()) throw new ProviderUrlError("Embedding model ID required");
      const response = await send("/embeddings", { model: modelId.trim(), input: "ping" });
      if (!response.ok) { await response.body?.cancel(); return { valid: false, error: "Embedding validation failed", method: "embeddings" }; }
      const reader = response.body?.getReader();
      const chunks = [];
      let size = 0;
      try {
        if (!reader) throw new Error("Missing embedding response");
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024 * 1024) throw new Error("Embedding validation response too large");
          chunks.push(value);
        }
      } finally { await reader?.cancel(); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const dimensions = Array.isArray(data?.data?.[0]?.embedding) ? data.data[0].embedding.length : null;
      return { valid: dimensions !== null, method: "embeddings", dimensions };
    }
    const response = await send("/models");
    await response.body?.cancel();
    if (response.ok || [401, 403].includes(response.status) || typeof modelId !== "string" || !modelId.trim()) return response.ok;
    const chat = await send("/chat/completions", { model: modelId.trim(), messages: [{ role: "user", content: "ping" }], max_tokens: 1 });
    await chat.body?.cancel();
    return chat.ok;
  } finally {
    await dispatcher.destroy();
  }
}
