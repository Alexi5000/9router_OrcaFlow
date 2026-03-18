export const REQUEST_FAILURE_CLASSES = {
  ROUTER_UNAVAILABLE: "router_unavailable",
  COMBO_EXHAUSTED: "combo_exhausted",
  PROVIDER_AUTH_FAILURE: "provider_auth_failure",
  REQUEST_INCOMPATIBILITY: "request_incompatibility",
  WORKER_PLUGIN_FAILURE: "worker_plugin_failure",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  UNKNOWN: "unknown",
};

function normalizeText(value) {
  return String(value || "").trim();
}

export function classifyRequestFailure({
  status = 0,
  message = "",
  errorCode = "",
  requestScopedFallback = false,
} = {}) {
  const code = Number(status) || 0;
  const normalizedMessage = normalizeText(message).toLowerCase();
  const normalizedCode = normalizeText(errorCode).toLowerCase();

  if (
    requestScopedFallback ||
    normalizedCode.includes("schema") ||
    normalizedMessage.includes("tool schema incompatible") ||
    normalizedMessage.includes("invalid request") ||
    normalizedMessage.includes("invalid json") ||
    normalizedMessage.includes("missing required field") ||
    normalizedMessage.includes("input required") ||
    normalizedMessage.includes("input must be") ||
    normalizedMessage.includes("messages must be") ||
    normalizedMessage.includes("messages array cannot be empty")
  ) {
    return REQUEST_FAILURE_CLASSES.REQUEST_INCOMPATIBILITY;
  }

  if (
    normalizedMessage.includes("worker-service") ||
    normalizedMessage.includes("hook failed") ||
    normalizedMessage.includes("plugin failed") ||
    normalizedMessage.includes("sessionstart") ||
    normalizedMessage.includes("posttooluse")
  ) {
    return REQUEST_FAILURE_CLASSES.WORKER_PLUGIN_FAILURE;
  }

  if (
    code === 401 ||
    code === 402 ||
    code === 403 ||
    normalizedMessage.includes("no credentials for provider") ||
    normalizedMessage.includes("invalid authentication credentials") ||
    normalizedMessage.includes("invalid api key") ||
    normalizedMessage.includes("invalid bearer token") ||
    normalizedMessage.includes("refresh token") ||
    normalizedMessage.includes("unauthorized") ||
    normalizedMessage.includes("forbidden")
  ) {
    return REQUEST_FAILURE_CLASSES.PROVIDER_AUTH_FAILURE;
  }

  if (
    code === 406 ||
    normalizedMessage.includes("all combo models unavailable") ||
    normalizedMessage.includes("all accounts unavailable") ||
    normalizedMessage.includes("no viable provider")
  ) {
    return REQUEST_FAILURE_CLASSES.COMBO_EXHAUSTED;
  }

  if (
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 503 ||
    code === 504 ||
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("capacity") ||
    normalizedMessage.includes("overloaded") ||
    normalizedMessage.includes("timeout")
  ) {
    return REQUEST_FAILURE_CLASSES.PROVIDER_UNAVAILABLE;
  }

  if (
    normalizedMessage.includes("econnrefused") ||
    normalizedMessage.includes("failed to connect") ||
    normalizedMessage.includes("router unavailable")
  ) {
    return REQUEST_FAILURE_CLASSES.ROUTER_UNAVAILABLE;
  }

  return REQUEST_FAILURE_CLASSES.UNKNOWN;
}
