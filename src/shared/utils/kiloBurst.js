export const KILO_BURST_MODELS = [
  "openrouter/hunter-alpha",
  "openrouter/healer-alpha",
];

function getNextHourIso(now = Date.now()) {
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  return nextHour.toISOString();
}

function getActiveModelLock(connection, model, now = Date.now()) {
  const key = `modelLock_${model}`;
  const value = connection?.[key];
  if (!value) return null;

  const lockUntil = new Date(value);
  if (Number.isNaN(lockUntil.getTime()) || lockUntil.getTime() <= now) {
    return null;
  }

  return lockUntil.toISOString();
}

export function getKiloBurstStatus(connections = [], now = Date.now()) {
  const kiloConnection = connections.find((connection) => connection.provider === "kilocode" && connection.isActive !== false);
  const nextResetAt = getNextHourIso(now);
  const nextResetInMs = Math.max(new Date(nextResetAt).getTime() - now, 0);

  if (!kiloConnection) {
    return {
      configured: false,
      active: false,
      parked: false,
      degraded: false,
      lockedModels: [],
      availableModels: [],
      resetAt: null,
      resetInMs: null,
      nextResetAt,
      nextResetInMs,
    };
  }

  const modelStates = KILO_BURST_MODELS.map((model) => ({
    model,
    lockUntil: getActiveModelLock(kiloConnection, model, now),
  }));

  const lockedModels = modelStates.filter((state) => state.lockUntil);
  const availableModels = modelStates.filter((state) => !state.lockUntil);
  const resetAt = lockedModels
    .map((state) => state.lockUntil)
    .sort()[0] || null;

  return {
    configured: true,
    active: availableModels.length > 0,
    parked: availableModels.length === 0,
    degraded: lockedModels.length > 0 && availableModels.length > 0,
    lockedModels,
    availableModels,
    resetAt,
    resetInMs: resetAt ? Math.max(new Date(resetAt).getTime() - now, 0) : null,
    nextResetAt,
    nextResetInMs,
  };
}

export function formatBurstCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

export function formatBurstTime(isoString) {
  if (!isoString) return "";

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}
