"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Badge from "./Badge";
import Card from "./Card";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageTable, {
  fmt,
  fmtTime,
} from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import ProviderTopology from "@/app/(dashboard)/dashboard/usage/components/ProviderTopology";
import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart";
import {
  TOPOLOGY_RECENT_WINDOW_MS,
  getRecentLastProvider,
  getRecentProvidersFromRequests,
} from "@/shared/utils/usageTopology";
import {
  buildRequestRouteSummary,
  normalizeRequestRoute,
} from "@/shared/utils/requestRoute";

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Auto-update time display every second without re-rendering parent
function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{timeAgo(timestamp)}</>;
}

function RecentRequests({ requests = [] }) {
  return (
    <Card
      className="flex flex-col overflow-hidden"
      padding="sm"
      style={{ height: 480 }}
    >
      {/* Header */}
      <div className="px-1 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
          Recent Requests
        </span>
      </div>

      {!requests.length ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          No requests yet.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-semibold text-text-muted w-2"></th>
                <th className="py-1.5 text-left font-semibold text-text-muted">
                  Model
                </th>
                <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">
                  In / Out
                </th>
                <th className="py-1.5 text-right font-semibold text-text-muted">
                  When
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {requests.map((r, i) => {
                const ok =
                  !r.status || r.status === "ok" || r.status === "success";
                const route = normalizeRequestRoute(r.route, {
                  requestedModel: r.model,
                  resolvedProvider: r.provider,
                  resolvedModel: r.model,
                  finalModel:
                    r.provider && r.model ? `${r.provider}/${r.model}` : null,
                });
                const displayModel = route.requestedModel || r.model;
                const routeSummary =
                  r.routeSummary || buildRequestRouteSummary(route);
                return (
                  <tr key={i} className="hover:bg-bg-subtle transition-colors">
                    <td className="py-1.5">
                      <span
                        className={`block w-1.5 h-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`}
                      />
                    </td>
                    <td className="py-1.5 max-w-[180px]">
                      <div className="flex flex-col">
                        <span
                          className="font-mono truncate"
                          title={displayModel}
                        >
                          {displayModel}
                        </span>
                        {routeSummary && routeSummary !== displayModel && (
                          <span
                            className="text-[11px] text-text-muted truncate"
                            title={routeSummary}
                          >
                            {routeSummary}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <span className="text-primary">
                        {fmt(r.promptTokens)}↑
                      </span>{" "}
                      <span className="text-success">
                        {fmt(r.completionTokens)}↓
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-text-muted whitespace-nowrap">
                      <TimeAgo timestamp={r.timestamp} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
  return Object.entries(dataMap || {})
    .map(([key, data]) => {
      const totalTokens =
        (data.promptTokens || 0) + (data.completionTokens || 0);
      const totalCost = data.cost || 0;
      const inputCost =
        totalTokens > 0
          ? (data.promptTokens || 0) * (totalCost / totalTokens)
          : 0;
      const outputCost =
        totalTokens > 0
          ? (data.completionTokens || 0) * (totalCost / totalTokens)
          : 0;
      return {
        ...data,
        key,
        totalTokens,
        totalCost,
        inputCost,
        outputCost,
        pending: pendingMap[key] || 0,
      };
    })
    .sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

function getGroupKey(item, keyField) {
  switch (keyField) {
    case "rawModel":
      return item.rawModel || "Unknown Model";
    case "accountName":
      return (
        item.accountName ||
        `Account ${item.connectionId?.slice(0, 8)}...` ||
        "Unknown Account"
      );
    case "keyName":
      return item.keyName || "Unknown Key";
    case "endpoint":
      return item.endpoint || "Unknown Endpoint";
    default:
      return item[keyField] || "Unknown";
  }
}

function groupDataByKey(data, keyField) {
  if (!Array.isArray(data)) return [];
  const groups = {};
  data.forEach((item) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cost: 0,
          inputCost: 0,
          outputCost: 0,
          lastUsed: null,
          pending: 0,
        },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.outputCost += item.outputCost || 0;
    s.pending += item.pending || 0;
    if (
      item.lastUsed &&
      (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))
    ) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "accountName", label: "Account" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API Key Name" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
];

const PERIODS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const STATS_FETCH_TIMEOUT_MS = 10000;
const TOPOLOGY_TICK_MS = 15 * 1000;
const LIVE_REFRESH_INTERVAL_MS = 30000;

async function fetchJsonWithTimeout(url, timeoutMs = STATS_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error("[UsageStats] fetch failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default function UsageStats() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [tableView, setTableView] = useState("model");
  const [providers, setProviders] = useState([]);
  const [period, setPeriod] = useState("7d");
  const [chartRefreshNonce, setChartRefreshNonce] = useState(0);
  const [topologyNow, setTopologyNow] = useState(() => Date.now());
  const hasLoadedStatsRef = useRef(false);
  const lastLiveUpdateAtRef = useRef(0);
  const lastFullRefreshAtRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(
      () => setTopologyNow(Date.now()),
      TOPOLOGY_TICK_MS,
    );
    return () => clearInterval(timer);
  }, []);

  const mergeStats = useCallback((data) => {
    if (!data) return;
    hasLoadedStatsRef.current = true;
    lastLiveUpdateAtRef.current = Date.now();
    if (data.kind === "full" || !lastFullRefreshAtRef.current) {
      lastFullRefreshAtRef.current = Date.now();
    }
    setStats((prev) => (prev ? { ...prev, ...data } : data));
    if (data.kind === "full") {
      setChartRefreshNonce((prev) => prev + 1);
    }
    setLoading(false);
  }, []);

  const fetchStatsSnapshot = useCallback(
    async ({ loud = false } = {}) => {
      if (loud) {
        if (!hasLoadedStatsRef.current) setLoading(true);
        else setFetching(true);
      }

      try {
        const data = await fetchJsonWithTimeout(
          `/api/usage/stats?period=${period}`,
        );
        if (data) {
          mergeStats({ ...data, kind: "full" });
        }
      } finally {
        if (loud) {
          setLoading(false);
          setFetching(false);
        }
      }
    },
    [mergeStats, period],
  );

  const recentProviders = useMemo(() => {
    return getRecentProvidersFromRequests(
      stats?.recentRequests,
      topologyNow,
      TOPOLOGY_RECENT_WINDOW_MS,
      4,
    );
  }, [stats?.recentRequests, topologyNow]);

  const recentLastProvider = useMemo(() => {
    return getRecentLastProvider(
      stats?.recentRequests,
      topologyNow,
      TOPOLOGY_RECENT_WINDOW_MS,
    );
  }, [stats?.recentRequests, topologyNow]);

  // Fetch connected provider accounts for the topology view.
  useEffect(() => {
    fetchJsonWithTimeout("/api/providers")
      .then((d) => {
        if (!d?.connections) return;
        setProviders(d.connections.filter((c) => c.isActive !== false));
      })
      .catch(() => {});
  }, []);

  // Fetch filtered stats via REST when period changes
  useEffect(() => {
    fetchStatsSnapshot({ loud: true }).catch(() => {});
  }, [fetchStatsSnapshot]);

  // SSE connection - keep period-filtered totals and live request state in sync.
  // Reconnects automatically with exponential backoff so the dashboard never
  // goes silently stale after a network hiccup or server restart.
  useEffect(() => {
    let es = null;
    let reconnectTimer = null;
    let backoffMs = 1000;
    const MAX_BACKOFF_MS = 30000;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      es = new EventSource(`/api/usage/stream?period=${period}`);

      es.onmessage = (e) => {
        backoffMs = 1000; // reset on any successful message
        try {
          const data = JSON.parse(e.data);
          mergeStats(data);
        } catch (err) {
          console.error("[SSE CLIENT] parse error:", err);
        }
      };

      es.onerror = () => {
        setLoading(false);
        es.close();
        if (!destroyed) {
          console.warn(
            `[SSE CLIENT] connection lost — reconnecting in ${backoffMs}ms`,
          );
          reconnectTimer = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
            connect();
          }, backoffMs);
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [mergeStats, period]);

  // Fallback live refresh. Some browser sessions or extensions can interfere
  // with EventSource, so we keep the dashboard moving with a silent no-cache
  // snapshot refresh while the page is visible.
  useEffect(() => {
    let cancelled = false;

    const refreshIfNeeded = async () => {
      if (cancelled || document.visibilityState !== "visible") return;

      const now = Date.now();
      const liveAgeMs = now - lastLiveUpdateAtRef.current;
      const fullAgeMs = now - lastFullRefreshAtRef.current;

      if (
        !lastLiveUpdateAtRef.current ||
        liveAgeMs > LIVE_REFRESH_INTERVAL_MS ||
        fullAgeMs > LIVE_REFRESH_INTERVAL_MS * 2
      ) {
        await fetchStatsSnapshot();
      }
    };

    const interval = setInterval(() => {
      refreshIfNeeded().catch(() => {});
    }, LIVE_REFRESH_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfNeeded().catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    refreshIfNeeded().catch(() => {});

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchStatsSnapshot]);

  const toggleSort = useCallback(
    (tableType, field) => {
      const params = new URLSearchParams(searchParams.toString());
      if (params.get("sortBy") === field) {
        params.set(
          "sortOrder",
          params.get("sortOrder") === "asc" ? "desc" : "asc",
        );
      } else {
        params.set("sortBy", field);
        params.set("sortOrder", "asc");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  // Compute active table data
  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    switch (tableView) {
      case "model": {
        const pendingMap = stats.pending?.byModel || {};
        return {
          columns: MODEL_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byModel, pendingMap, sortBy, sortOrder),
            "rawModel",
          ),
          storageKey: "usage-stats:expanded-models",
          emptyMessage: "No usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">
                {fmt(group.summary.requests)}
              </td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                {fmtTime(group.summary.lastUsed)}
              </td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td
                className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}
              >
                {item.rawModel}
              </td>
              <td className="px-6 py-3">
                <Badge
                  variant={item.pending > 0 ? "primary" : "neutral"}
                  size="sm"
                >
                  {item.provider}
                </Badge>
              </td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                {fmtTime(item.lastUsed)}
              </td>
            </>
          ),
        };
      }
      case "account": {
        const pendingMap = {};
        if (stats?.pending?.byAccount) {
          Object.entries(stats.byAccount || {}).forEach(
            ([accountKey, data]) => {
              const connPending = stats.pending.byAccount[data.connectionId];
              if (connPending) {
                const modelKey = data.provider
                  ? `${data.rawModel} (${data.provider})`
                  : data.rawModel;
                pendingMap[accountKey] = connPending[modelKey] || 0;
              }
            },
          );
        }
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byAccount, pendingMap, sortBy, sortOrder),
            "accountName",
          ),
          storageKey: "usage-stats:expanded-accounts",
          emptyMessage: "No account-specific usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">
                {fmt(group.summary.requests)}
              </td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                {fmtTime(group.summary.lastUsed)}
              </td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td
                className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}
              >
                {item.accountName ||
                  `Account ${item.connectionId?.slice(0, 8)}...`}
              </td>
              <td
                className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}
              >
                {item.rawModel}
              </td>
              <td className="px-6 py-3">
                <Badge
                  variant={item.pending > 0 ? "primary" : "neutral"}
                  size="sm"
                >
                  {item.provider}
                </Badge>
              </td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                {fmtTime(item.lastUsed)}
              </td>
            </>
          ),
        };
      }
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byApiKey, {}, sortBy, sortOrder),
            "keyName",
          ),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No API key usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">
                {fmt(group.summary.requests)}
              </td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                {fmtTime(group.summary.lastUsed)}
              </td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-medium">{item.keyName}</td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3">
                <Badge variant="neutral" size="sm">
                  {item.provider}
                </Badge>
              </td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                {fmtTime(item.lastUsed)}
              </td>
            </>
          ),
        };
      }
      case "endpoint":
      default: {
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byEndpoint, {}, sortBy, sortOrder),
            "endpoint",
          ),
          storageKey: "usage-stats:expanded-endpoints",
          emptyMessage: "No endpoint usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">
                {fmt(group.summary.requests)}
              </td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                {fmtTime(group.summary.lastUsed)}
              </td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-medium font-mono text-sm">
                {item.endpoint}
              </td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3">
                <Badge variant="neutral" size="sm">
                  {item.provider}
                </Badge>
              </td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                {fmtTime(item.lastUsed)}
              </td>
            </>
          ),
        };
      }
    }
  }, [stats, tableView, sortBy, sortOrder]);

  if (!stats && !loading)
    return (
      <div className="text-text-muted">Failed to load usage statistics.</div>
    );

  const spinner = (
    <div className="flex items-center justify-center py-12 text-text-muted">
      <span className="material-symbols-outlined text-[32px] animate-spin">
        progress_activity
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Period selector */}
      <div className="flex items-center gap-2 self-end">
        <div className="flex items-center gap-1 bg-bg-subtle rounded-lg p-1 border border-border">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              disabled={fetching}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${period === p.value ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {fetching && (
          <span className="material-symbols-outlined text-[16px] text-text-muted animate-spin">
            progress_activity
          </span>
        )}
      </div>

      {/* Overview cards */}
      {loading ? spinner : <OverviewCards stats={stats} />}

      {/* Provider topology + Recent Requests */}
      {loading ? (
        spinner
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-2 items-stretch">
          <ProviderTopology
            providers={providers}
            activeRequests={stats.activeRequests || []}
            recentRequests={stats.recentRequests || []}
            recentProviders={recentProviders}
            lastProvider={recentLastProvider}
            errorProvider={stats.errorProvider || ""}
          />
          <RecentRequests requests={stats.recentRequests || []} />
        </div>
      )}

      {/* Token / Cost chart - sync period */}
      {loading ? (
        spinner
      ) : (
        <UsageChart period={period} refreshNonce={chartRefreshNonce} />
      )}

      {/* Table with dropdown selector */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <select
            value={tableView}
            onChange={(e) => setTableView(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-bg-subtle text-sm font-medium text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {TABLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {loading
          ? spinner
          : activeTableConfig && (
              <UsageTable
                title=""
                columns={activeTableConfig.columns}
                groupedData={activeTableConfig.groupedData}
                tableType={tableView}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggleSort={toggleSort}
                storageKey={activeTableConfig.storageKey}
                renderSummaryCells={activeTableConfig.renderSummaryCells}
                renderDetailCells={activeTableConfig.renderDetailCells}
                emptyMessage={activeTableConfig.emptyMessage}
              />
            )}
      </div>
    </div>
  );
}
