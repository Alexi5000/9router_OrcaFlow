import fs from "node:fs";
import path from "node:path";
import { getDefaultPricing, calculateCostFromTokens } from "../src/shared/constants/pricing.js";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
function normalizeDataDir(rawPath) {
  if (!rawPath) return path.join(appRoot, "data");
  if (process.platform === "win32") return rawPath;

  const winDriveMatch = rawPath.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!winDriveMatch) return rawPath;

  const [, drive, remainder] = winDriveMatch;
  return path.posix.join("/mnt", drive.toLowerCase(), remainder.replace(/\\/g, "/"));
}

const dataDir = normalizeDataDir(process.env.DATA_DIR);
const usagePath = path.join(dataDir, "usage.json");
const dbPath = path.join(dataDir, "db.json");

const PROVIDER_ID_TO_ALIAS = {
  claude: "cc",
  codex: "cx",
  "gemini-cli": "gc",
  qwen: "qw",
  iflow: "if",
  antigravity: "ag",
  github: "gh",
  kiro: "kr",
  kilocode: "kilocode",
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  openrouter: "openrouter",
  glm: "glm",
  kimi: "kimi",
  minimax: "minimax",
};

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function mergePricing(defaultPricing, userPricing) {
  const merged = {};

  for (const [provider, models] of Object.entries(defaultPricing)) {
    merged[provider] = { ...models };
    if (userPricing?.[provider]) {
      for (const [model, pricing] of Object.entries(userPricing[provider])) {
        merged[provider][model] = merged[provider][model]
          ? { ...merged[provider][model], ...pricing }
          : pricing;
      }
    }
  }

  for (const [provider, models] of Object.entries(userPricing || {})) {
    if (!merged[provider]) merged[provider] = {};
    for (const [model, pricing] of Object.entries(models || {})) {
      if (!merged[provider][model]) merged[provider][model] = pricing;
    }
  }

  return merged;
}

function getPricingForEntry(pricing, provider, model) {
  if (!provider || !model) return null;

  const candidateModels = new Set([model]);
  const parts = model.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    candidateModels.add(parts.slice(i).join("/"));
  }
  if (parts.length) candidateModels.add(parts[parts.length - 1]);

  const lookup = (providerKey) => {
    if (!providerKey || !pricing[providerKey]) return null;
    for (const candidate of candidateModels) {
      if (pricing[providerKey][candidate]) return pricing[providerKey][candidate];
    }
    return null;
  };

  return lookup(provider) || lookup(PROVIDER_ID_TO_ALIAS[provider]) || null;
}

const usage = loadJson(usagePath);
const db = loadJson(dbPath);
const pricing = mergePricing(getDefaultPricing(), db.pricing || {});

let changed = 0;
for (const entry of usage.history || []) {
  if ((entry.cost || 0) > 0) continue;
  const modelPricing = getPricingForEntry(pricing, entry.provider, entry.model);
  const cost = calculateCostFromTokens(entry.tokens || {}, modelPricing);
  if (cost > 0) {
    entry.cost = cost;
    changed++;
  }
}

fs.writeFileSync(usagePath, JSON.stringify(usage, null, 2));
console.log(JSON.stringify({ changed, total: usage.history?.length || 0 }, null, 2));
