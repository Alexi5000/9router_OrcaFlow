import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { getProviderConnections } from "@/lib/localDb";
import { resolveClaudeSettingsPath } from "@/shared/utils/claudeConfig.js";
import { getEffectiveConnectionStatus } from "@/shared/utils/providerHealth.js";

export const dynamic = "force-dynamic";

const WINDOWS_CLAUDE_LOGS = "/mnt/c/Users/Admin/AppData/Roaming/Claude/logs";
const RECENT_ACTIVITY_WINDOW_MS = 30 * 60 * 1000;
const APP_ROOT = process.cwd();

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function statMtime(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime.toISOString();
  } catch {
    return null;
  }
}

function summarizeProviders(connections = []) {
  const grouped = new Map();

  for (const connection of connections) {
    const provider = connection.provider || "unknown";
    if (!grouped.has(provider)) grouped.set(provider, []);
    grouped.get(provider).push(connection);
  }

  const providers = {};
  for (const [provider, items] of grouped.entries()) {
    const effectiveStatuses = items.map((item) => getEffectiveConnectionStatus(item) || item.testStatus || "unknown");
    const status = effectiveStatuses.includes("active")
      ? "active"
      : effectiveStatuses.includes("unknown")
        ? "unknown"
        : "unavailable";

    providers[provider] = {
      status,
      connections: items.map((item) => ({
        id: item.id,
        name: item.name,
        testStatus: item.testStatus || null,
        effectiveStatus: getEffectiveConnectionStatus(item) || item.testStatus || null,
        lastError: item.lastError || null,
        lastErrorAt: item.lastErrorAt || null,
      })),
    };
  }

  return providers;
}

function isRecent(isoString) {
  if (!isoString) return false;
  const time = new Date(isoString).getTime();
  return Number.isFinite(time) && (Date.now() - time) <= RECENT_ACTIVITY_WINDOW_MS;
}

export async function GET() {
  const settingsPath = resolveClaudeSettingsPath();
  const settings = (await readJson(settingsPath)) || {};
  const claudeDir = path.dirname(settingsPath);
  const connections = await getProviderConnections({ isActive: true });
  const providers = summarizeProviders(connections);

  const workerCommands = [];
  for (const hookList of Object.values(settings?.hooks || {})) {
    for (const hookEntry of hookList || []) {
      for (const hook of hookEntry?.hooks || []) {
        if (typeof hook?.command === "string" && hook.command.includes("worker-service.cjs")) {
          workerCommands.push(hook.command);
        }
      }
    }
  }

  const mainLogAt = await statMtime(path.join(WINDOWS_CLAUDE_LOGS, "main.log"));
  const coworkVmLogAt = await statMtime(path.join(WINDOWS_CLAUDE_LOGS, "cowork_vm_node.log"));
  const workerStatusPath = path.join(claudeDir, "logs", "worker-service-status.json");
  const workerLogPath = path.join(claudeDir, "logs", "worker-service.log");
  const workerStatus = (await readJson(workerStatusPath)) || null;
  const workerLogAt = await statMtime(workerLogPath);
  const workerLogRecent = isRecent(workerLogAt);
  const workerExternalDegraded = Array.isArray(workerStatus?.externalState)
    ? workerStatus.externalState.some((item) => item?.ok === false)
    : false;
  const workerState = workerCommands.length === 0
    ? "not_configured"
    : workerExternalDegraded
      ? "degraded"
      : (workerLogRecent || isRecent(mainLogAt) || isRecent(coworkVmLogAt) ? "active" : "degraded");

  const baseUrl = settings?.env?.ANTHROPIC_BASE_URL || null;
  const strictBaseUrl = baseUrl === "http://localhost:20128/v1";
  const pkg = (await readJson(path.join(APP_ROOT, "package.json"))) || {};

  const response = {
    router: {
      status: "online",
      version: pkg.version || null,
      anthropicEndpoint: "http://localhost:20128/v1/messages",
      strictBaseUrlConfigured: strictBaseUrl,
      configPath: settingsPath,
    },
    clientConfig: {
      anthropicBaseUrl: baseUrl,
      defaultModel: settings?.env?.ANTHROPIC_MODEL || null,
      defaultSonnetModel: settings?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL || null,
      defaultOpusModel: settings?.env?.ANTHROPIC_DEFAULT_OPUS_MODEL || null,
    },
    providers: {
      summary: providers,
      critical: {
        claude: providers.claude?.status || "missing",
        codex: providers.codex?.status || "missing",
        kilocode: providers.kilocode?.status || "missing",
        github: providers.github?.status || "missing",
      },
    },
    worker: {
      configured: workerCommands.length > 0,
      commands: workerCommands,
      logPath: workerLogPath,
      logAt: workerLogAt,
      logRecent: workerLogRecent,
      statusFile: workerStatusPath,
      statusFileUpdatedAt: workerStatus?.updatedAt || null,
      degraded: workerExternalDegraded,
      mainLogAt,
      coworkVmLogAt,
      mainLogRecent: isRecent(mainLogAt),
      coworkVmRecent: isRecent(coworkVmLogAt),
      status: workerState,
    },
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
