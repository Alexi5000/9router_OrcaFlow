"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import {
  ReactFlow,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AI_PROVIDERS } from "@/shared/constants/providers";

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { color: "#6b7280", name: providerId };
}

// Use local provider images from /public/providers/
function getProviderImageUrl(providerId) {
  return `/providers/${providerId}.png`;
}

// Custom provider node - rectangle with image + name
function ProviderNode({ data }) {
  const { label, color, imageUrl, textIcon, active, recent, activityLabel, activityMeta } = data;
  const [imgError, setImgError] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 transition-all duration-300 bg-bg"
      style={{
        borderColor: active || recent ? color : "var(--color-border)",
        boxShadow: active ? `0 0 16px ${color}40` : recent ? `0 0 12px ${color}2a` : "none",
        minWidth: "150px",
      }}
    >
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      {/* Provider icon */}
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        {!imgError ? (
          <img src={imageUrl} alt={label} className="w-6 h-6 rounded-sm object-contain" onError={() => setImgError(true)} />
        ) : (
          <span className="text-sm font-bold" style={{ color }}>{textIcon}</span>
        )}
      </div>

      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <span
          className="text-base font-medium truncate"
          style={{ color: active || recent ? color : "var(--color-text)" }}
        >
          {label}
        </span>
        {activityLabel && (
          <span
            className="text-[11px] truncate"
            style={{ color: active ? color : "var(--color-text-muted)" }}
            title={activityMeta ? `${activityLabel} • ${activityMeta}` : activityLabel}
          >
            {activityLabel}
            {activityMeta ? ` • ${activityMeta}` : ""}
          </span>
        )}
      </div>

      {/* Active indicator */}
      {active && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
        </span>
      )}
      {!active && recent && (
        <span className="relative inline-flex rounded-full h-2 w-2 shrink-0" style={{ backgroundColor: color, opacity: 0.8 }} />
      )}
    </div>
  );
}

ProviderNode.propTypes = {
  data: PropTypes.object.isRequired,
};

// Center 9Router node
function RouterNode({ data }) {
  return (
    <div className="flex items-center justify-center px-5 py-3 rounded-xl border-2 border-primary bg-primary/5 shadow-md min-w-[130px]">
      <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      <img src="/favicon.svg" alt="9Router" className="w-6 h-6 mr-2" />
      <span className="text-sm font-bold text-primary">9Router</span>
      {data.activeCount > 0 && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-primary text-white text-xs font-bold">
          {data.activeCount}
        </span>
      )}
    </div>
  );
}

RouterNode.propTypes = {
  data: PropTypes.object.isRequired,
};

const nodeTypes = { provider: ProviderNode, router: RouterNode };

// Place N nodes evenly along an ellipse around the router center.
function buildLayout(providers, activeSet, recentSet, lastSet, errorSet, activeByProvider, recentByProvider) {
  const nodeW = 180;
  const nodeH = 30;
  const routerW = 120;
  const routerH = 44;
  const nodeGap = 24;

  const count = providers.length;

  // Compute rx so arc spacing between nodes >= nodeW + nodeGap
  const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const rx = Math.max(320, minRx);
  const ry = Math.max(200, rx * 0.55); // ellipse ratio ~0.55
  if (count === 0) {
    return {
      nodes: [{ id: "router", type: "router", position: { x: 0, y: 0 }, data: { activeCount: 0 }, draggable: false }],
      edges: [],
    };
  }

  const nodes = [];
  const edges = [];
  const providerCounts = providers.reduce((acc, provider) => {
    const key = provider.provider || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    data: { activeCount: activeSet.size },
    draggable: false,
  });

  const edgeStyle = (active, recent, last, error, color) => {
    if (error) return { stroke: "#ef4444", strokeWidth: 2.5, opacity: 0.9 };
    if (active) return { stroke: "#22c55e", strokeWidth: 2.5, opacity: 0.9 };
    if (recent) return { stroke: color || "#f59e0b", strokeWidth: 2.25, opacity: 0.8 };
    if (last) return { stroke: "#f59e0b", strokeWidth: 2, opacity: 0.7 };
    return { stroke: "var(--color-border)", strokeWidth: 1, opacity: 0.3 };
  };

  providers.forEach((p, i) => {
    const config = getProviderConfig(p.provider);
    const active = activeSet.has(p.provider?.toLowerCase());
    const recent = !active && recentSet.has(p.provider?.toLowerCase());
    const last = !active && lastSet.has(p.provider?.toLowerCase());
    const error = !active && errorSet.has(p.provider?.toLowerCase());
    const nodeId = `provider-${p.provider}-${p.id || i}`;
    const accountLabel = p.displayName || p.name || p.email || (p.id ? `Account ${String(p.id).slice(0, 8)}` : null);
    const label = providerCounts[p.provider] > 1
      ? `${config.name || p.provider} · ${accountLabel || `Account ${i + 1}`}`
      : (p.label || (config.name !== p.provider ? config.name : null) || p.name || p.provider);
    const data = {
      label,
      color: config.color || "#6b7280",
      imageUrl: getProviderImageUrl(p.provider),
      textIcon: config.textIcon || (p.provider || "?").slice(0, 2).toUpperCase(),
      active,
      recent,
      activityLabel: activeByProvider[p.provider?.toLowerCase()]?.label || recentByProvider[p.provider?.toLowerCase()]?.label || "",
      activityMeta: activeByProvider[p.provider?.toLowerCase()]?.meta || recentByProvider[p.provider?.toLowerCase()]?.meta || "",
    };

    // Distribute evenly starting from top (−π/2), clockwise
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    // Pick router handle closest to the node direction
    let sourceHandle, targetHandle;
    if (Math.abs(angle + Math.PI / 2) < Math.PI / 4 || Math.abs(angle - 3 * Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "top"; targetHandle = "bottom";
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom"; targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right"; targetHandle = "left";
    } else {
      sourceHandle = "left"; targetHandle = "right";
    }

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      data,
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      source: "router",
      sourceHandle,
      target: nodeId,
      targetHandle,
      animated: active,
      style: edgeStyle(active, recent, last, error, config.color),
    });
  });

  return { nodes, edges };
}

function buildActiveByProvider(activeRequests = []) {
  const map = {};

  for (const request of activeRequests) {
    const provider = request?.provider?.toLowerCase?.();
    if (!provider) continue;

    const model = request?.model || "unknown";
    const count = Number(request?.count) || 0;
    const existing = map[provider] || { models: new Set(), totalCount: 0 };
    existing.models.add(model);
    existing.totalCount += Math.max(count, 1);
    map[provider] = existing;
  }

  return Object.fromEntries(Object.entries(map).map(([provider, entry]) => {
    const models = [...entry.models];
    const firstModel = models[0] || "unknown";
    const extraModels = models.length > 1 ? ` +${models.length - 1}` : "";
    const countMeta = entry.totalCount > 1 ? `${entry.totalCount} active` : "live";
    return [provider, {
      label: firstModel + extraModels,
      meta: countMeta,
    }];
  }));
}

function buildRecentByProvider(recentRequests = [], recentProviders = []) {
  const providerSet = new Set((recentProviders || []).map((provider) => provider?.toLowerCase?.()).filter(Boolean));
  const map = {};

  for (const request of recentRequests || []) {
    const provider = request?.provider?.toLowerCase?.();
    if (!provider || !providerSet.has(provider) || map[provider]) continue;

    map[provider] = {
      label: request?.route?.requestedModel || request?.model || "recent request",
      meta: "recent",
    };
  }

  return map;
}

export default function ProviderTopology({ providers = [], activeRequests = [], recentRequests = [], recentProviders = [], lastProvider = "", errorProvider = "" }) {
  // Serialize all live state to stable string keys.
  // This prevents useMemo from recomputing (and ReactFlow from re-rendering)
  // when props contain new array/object references with identical content.
  const activeKey = useMemo(
    () => activeRequests.map((r) => r.provider?.toLowerCase()).filter(Boolean).sort().join(","),
    [activeRequests]
  );
  // Stable string key for recent providers — avoids creating a new Set reference
  // on every render, which was the root cause of constant ReactFlow remounts.
  const recentKey = useMemo(
    () => (recentProviders || []).map((p) => p?.toLowerCase()).filter(Boolean).sort().join(","),
    [recentProviders]
  );
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";

  const activeSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const recentSet = useMemo(() => new Set(recentKey ? recentKey.split(",") : []), [recentKey]);
  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);
  const activeByProvider = useMemo(() => buildActiveByProvider(activeRequests), [activeRequests]);
  const recentByProvider = useMemo(() => buildRecentByProvider(recentRequests, recentProviders), [recentRequests, recentProviders]);

  // Use stable string keys as deps so nodes/edges only recompute when values change,
  // not when array/Set references change (which happens on every SSE event).
  const { nodes, edges } = useMemo(
    () => buildLayout(providers, activeSet, recentSet, lastSet, errorSet, activeByProvider, recentByProvider),
    [providers, activeKey, recentKey, lastKey, errorKey, activeByProvider, recentByProvider]
  );

  // Stable key — only remount ReactFlow when the provider list structure changes.
  // Do NOT include liveKey: nodes/edges are controlled props and update in-place
  // without needing a full remount. Including liveKey caused ReactFlow to remount
  // on every SSE event (~2s), destroying all edge animations before they were visible.
  const providersKey = useMemo(
    () => providers.map((p) => p.id || `${p.provider}:${p.name || ""}`).sort().join(","),
    [providers]
  );

  const rfInstance = useRef(null);
  const onInit = useCallback((instance) => {
    rfInstance.current = instance;
    setTimeout(() => instance.fitView({ padding: 0.3 }), 50);
  }, []);

  return (
    <div className="w-full rounded-lg border border-border bg-bg-subtle/30" style={{ height: 480 }}>
      {providers.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          No providers connected
        </div>
      ) : (
        <ReactFlow
          key={providersKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        />
      )}
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    provider: PropTypes.string,
    name: PropTypes.string,
  })),
  activeRequests: PropTypes.arrayOf(PropTypes.shape({
    provider: PropTypes.string,
    model: PropTypes.string,
    account: PropTypes.string,
  })),
  recentRequests: PropTypes.arrayOf(PropTypes.shape({
    provider: PropTypes.string,
    model: PropTypes.string,
    route: PropTypes.object,
  })),
  recentProviders: PropTypes.arrayOf(PropTypes.string),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};
