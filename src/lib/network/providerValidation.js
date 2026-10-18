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

export async function validateProvider(baseUrl, apiKey, type) {
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

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      dispatcher,
    });
    await response.body?.cancel();
    return response.ok;
  } finally {
    await dispatcher.destroy();
  }
}
