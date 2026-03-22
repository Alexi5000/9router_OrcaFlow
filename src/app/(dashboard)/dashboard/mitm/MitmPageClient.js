"use client";

import { useState, useEffect } from "react";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getModelsByProviderId } from "@/shared/constants/models";
import {
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";
import {
  MitmServerCard,
  MitmToolCard,
} from "@/app/(dashboard)/dashboard/cli-tools/components";

const MITM_TOOL_IDS = ["antigravity", "copilot"];

export default function MitmPageClient() {
  const [connections, setConnections] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [expandedTool, setExpandedTool] = useState(null);
  const [mitmStatus, setMitmStatus] = useState({
    running: false,
    certExists: false,
    dnsStatus: {},
    hasCachedPassword: false,
  });

  useEffect(() => {
    let cancelled = false;

    const loadPageState = async () => {
      try {
        const [connectionsRes, apiKeysRes, aliasesRes, settingsRes] =
          await Promise.all([
            fetch("/api/providers", { cache: "no-store" }),
            fetch("/api/keys", { cache: "no-store" }),
            fetch("/api/models/alias", { cache: "no-store" }),
            fetch("/api/settings", { cache: "no-store" }),
          ]);

        if (cancelled) {
          return;
        }

        if (connectionsRes.ok) {
          const data = await connectionsRes.json();
          if (!cancelled) {
            setConnections(data.connections || []);
          }
        }

        if (apiKeysRes.ok) {
          const data = await apiKeysRes.json();
          if (!cancelled) {
            setApiKeys(data.keys || []);
          }
        }

        if (aliasesRes.ok) {
          const data = await aliasesRes.json();
          if (!cancelled) {
            setModelAliases(data.aliases || {});
          }
        }

        if (settingsRes.ok) {
          const data = await settingsRes.json();
          if (!cancelled) {
            setCloudEnabled(data.cloudEnabled || false);
          }
        }
      } catch {
        // Best-effort hydration for dashboard view.
      }
    };

    void loadPageState();

    return () => {
      cancelled = true;
    };
  }, []);

  const getActiveProviders = () =>
    connections.filter((connection) => connection.isActive !== false);

  const hasActiveProviders = () => {
    const active = getActiveProviders();
    return active.some(
      (connection) =>
        getModelsByProviderId(connection.provider).length > 0 ||
        isOpenAICompatibleProvider(connection.provider) ||
        isAnthropicCompatibleProvider(connection.provider),
    );
  };

  const mitmTools = Object.entries(CLI_TOOLS).filter(([id]) =>
    MITM_TOOL_IDS.includes(id),
  );

  return (
    <div className="flex flex-col gap-6">
      <MitmServerCard
        apiKeys={apiKeys}
        cloudEnabled={cloudEnabled}
        onStatusChange={setMitmStatus}
      />

      <div className="flex flex-col gap-2">
        {mitmTools.map(([toolId, tool]) => (
          <MitmToolCard
            key={toolId}
            tool={tool}
            isExpanded={expandedTool === toolId}
            onToggle={() =>
              setExpandedTool(expandedTool === toolId ? null : toolId)
            }
            serverRunning={mitmStatus.running}
            dnsActive={mitmStatus.dnsStatus?.[toolId] || false}
            hasCachedPassword={mitmStatus.hasCachedPassword || false}
            apiKeys={apiKeys}
            activeProviders={getActiveProviders()}
            hasActiveProviders={hasActiveProviders()}
            modelAliases={modelAliases}
            cloudEnabled={cloudEnabled}
            onDnsChange={(data) =>
              setMitmStatus((prev) => ({
                ...prev,
                dnsStatus: data.dnsStatus ?? prev.dnsStatus,
              }))
            }
          />
        ))}
      </div>
    </div>
  );
}
