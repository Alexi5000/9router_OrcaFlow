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
  const trimmed = String(baseUrl).trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed.replace(/\/chat\/completions$/, "");
  }
  return `${trimmed}/v1`;
}

export function normalizeDeepSeekCliApiUrl(baseUrlOrApiUrl) {
  if (!baseUrlOrApiUrl) return "https://api.deepseek.com/chat/completions";
  const trimmed = String(baseUrlOrApiUrl).trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  if (trimmed.startsWith("https://api.deepseek.com")) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}
