"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function renderKiloHeadline(kiloHourly) {
  if (!kiloHourly) return "Checking...";
  if (kiloHourly.state === "parked" || kiloHourly.state === "unavailable")
    return "Temporarily parked";
  if (kiloHourly.state === "degraded")
    return `${fmt(kiloHourly.remainingRequests)} left`;
  if (kiloHourly.state === "unconfigured") return "Not configured";
  return `${fmt(kiloHourly.remainingRequests)} left`;
}

function renderKiloDetail(kiloHourly) {
  if (!kiloHourly) return "Loading Kilo availability...";

  if (kiloHourly.state === "parked") {
    const resetAt = kiloHourly.burst?.resetAt || kiloHourly.resetAt;
    return `Burst locked until ${resetAt ? new Date(resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "soon"}`;
  }

  if (kiloHourly.state === "unavailable") {
    return kiloHourly.lastError || "Provider temporarily unavailable";
  }

  if (kiloHourly.state === "degraded") {
    return `${kiloHourly.burst?.availableModels?.length || 0} lane live, resets ${kiloHourly.resetAt ? new Date(kiloHourly.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "soon"}`;
  }

  if (kiloHourly.state === "unconfigured") {
    return "Add a Kilo connection to enable burst routing";
  }

  return `${fmt(kiloHourly.requestsThisHour)}/${fmt(kiloHourly.requestLimit)} used, resets ${kiloHourly.resetAt ? new Date(kiloHourly.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "soon"}`;
}

export default function OverviewCards({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-text-muted text-sm uppercase font-semibold">
          Total Requests
        </span>
        <span className="text-2xl font-bold">{fmt(stats.totalRequests)}</span>
        <span className="text-[10px] text-text-muted">
          {stats.pendingRequestCount > 0
            ? `+${fmt(stats.pendingRequestCount)} live right now`
            : "Live count updates during active streams"}
        </span>
      </Card>
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-text-muted text-sm uppercase font-semibold">
          Total Input Tokens
        </span>
        <span className="text-2xl font-bold text-primary">
          {fmt(stats.totalPromptTokens)}
        </span>
      </Card>
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-text-muted text-sm uppercase font-semibold">
          Output Tokens
        </span>
        <span className="text-2xl font-bold text-success">
          {fmt(stats.totalCompletionTokens)}
        </span>
      </Card>
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-text-muted text-sm uppercase font-semibold">
          Est. Cost
        </span>
        <span className="text-2xl font-bold text-warning">
          ~{fmtCost(stats.totalCost)}
        </span>
        <span className="text-[10px] text-text-muted">
          Estimated, not actual billing
        </span>
      </Card>
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-text-muted text-sm uppercase font-semibold">
          Kilo This Hour
        </span>
        <span className="text-2xl font-bold text-[#FF6B35]">
          {renderKiloHeadline(stats.kiloHourly)}
        </span>
        <span className="text-[10px] text-text-muted">
          {renderKiloDetail(stats.kiloHourly)}
        </span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
