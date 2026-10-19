import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WINDOWS_ADMIN_HOME = "/mnt/c/Users/Admin";

export function getDeepSeekCliConfigCandidates() {
  const homeDir = os.homedir();
  return [
    path.join(WINDOWS_ADMIN_HOME, ".deepseek-cli.json"),
    path.join(homeDir, ".deepseek-cli.json"),
  ];
}

export function resolveDeepSeekCliConfigPath() {
  for (const candidate of getDeepSeekCliConfigCandidates()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return getDeepSeekCliConfigCandidates()[0];
}

export function normalizeDeepSeekCliBaseUrl(baseUrl) {
  if (!baseUrl) return "http://localhost:20128/v1";
  const url = parseDeepSeekCliUrl(baseUrl);
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) {
    pathname = pathname.slice(0, -"/chat/completions".length);
  } else if (!pathname.endsWith("/v1")) {
    pathname += "/v1";
  }
  url.pathname = pathname;
  return url.toString();
}

export function normalizeDeepSeekCliApiUrl(baseUrlOrApiUrl) {
  if (!baseUrlOrApiUrl) return "https://api.deepseek.com/chat/completions";
  const url = parseDeepSeekCliUrl(baseUrlOrApiUrl);
  let pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/chat/completions")) {
    if (!pathname.endsWith("/v1") && url.origin !== "https://api.deepseek.com") {
      pathname += "/v1";
    }
    pathname += "/chat/completions";
  }
  url.pathname = pathname;
  return url.toString();
}

function parseDeepSeekCliUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Invalid API URL");
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError("Invalid API URL");
  }
  return url;
}

export function isLocalDeepSeekRouterUrl(value) {
  try {
    const url = parseDeepSeekCliUrl(value);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "20128";
  } catch {
    return false;
  }
}
