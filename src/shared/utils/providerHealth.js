export function hasActiveModelLock(connection, now = Date.now()) {
  if (!connection) return false;

  return Object.entries(connection).some(([key, value]) => {
    if (!key.startsWith("modelLock_") || !value) return false;
    const expiry = new Date(value).getTime();
    return Number.isFinite(expiry) && expiry > now;
  });
}

export function isGlobalProviderHealthError(status = 0, errorText = "") {
  const code = Number(status) || 0;
  const message = String(errorText || "").toLowerCase();

  if (code === 401 || code === 402 || code === 403) {
    return true;
  }

  return (
    message.includes("oauth token has expired") ||
    message.includes("token has expired") ||
    message.includes("refresh token") ||
    message.includes("refresh failed") ||
    message.includes("invalid api key") ||
    message.includes("api key invalid") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("no credentials")
  );
}

export function getEffectiveConnectionStatus(connection, now = Date.now()) {
  if (!connection) return null;
  if (connection.testStatus !== "unavailable") return connection.testStatus;

  if (hasActiveModelLock(connection, now) && !isGlobalProviderHealthError(connection.errorCode, connection.lastError || "")) {
    return "active";
  }

  return connection.testStatus;
}
