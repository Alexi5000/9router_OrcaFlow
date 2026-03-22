function cleanString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const cleaned = cleanString(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }

  return result;
}

function sanitizeAttempts(attempts = []) {
  if (!Array.isArray(attempts)) return [];

  return attempts
    .filter((attempt) => attempt && typeof attempt === "object")
    .map((attempt) => ({
      requestedModel: cleanString(attempt.requestedModel),
      selectedModel: cleanString(attempt.selectedModel),
      provider: cleanString(attempt.provider),
      model: cleanString(attempt.model),
      finalModel: cleanString(attempt.finalModel),
      status: cleanString(attempt.status),
      errorClass: cleanString(attempt.errorClass),
      errorCode: cleanString(attempt.errorCode),
      message: cleanString(attempt.message),
      statusCode: Number.isFinite(Number(attempt.statusCode))
        ? Number(attempt.statusCode)
        : null,
      timestamp: cleanString(attempt.timestamp),
    }));
}

export function normalizeRequestRoute(route = {}, fallback = {}) {
  const requestedModel =
    cleanString(route.requestedModel) || cleanString(fallback.requestedModel);
  const comboName =
    cleanString(route.comboName) || cleanString(fallback.comboName);
  const tierName =
    cleanString(route.tierName) || cleanString(fallback.tierName);
  const requestedAlias =
    cleanString(route.requestedAlias) || cleanString(fallback.requestedAlias);
  const selectedModel =
    cleanString(route.selectedModel) || cleanString(fallback.selectedModel);
  const resolvedProvider =
    cleanString(route.resolvedProvider) ||
    cleanString(fallback.resolvedProvider);
  const resolvedModel =
    cleanString(route.resolvedModel) || cleanString(fallback.resolvedModel);
  const finalModel =
    cleanString(route.finalModel) ||
    cleanString(fallback.finalModel) ||
    (resolvedProvider && resolvedModel
      ? `${resolvedProvider}/${resolvedModel}`
      : null);

  const attemptedModels = uniqueStrings([
    ...(Array.isArray(route.attemptedModels) ? route.attemptedModels : []),
    ...(Array.isArray(fallback.attemptedModels)
      ? fallback.attemptedModels
      : []),
  ]);
  const attempts = sanitizeAttempts([
    ...(Array.isArray(route.attempts) ? route.attempts : []),
    ...(Array.isArray(fallback.attempts) ? fallback.attempts : []),
  ]);

  const parts = [];
  if (requestedModel) parts.push(requestedModel);
  if (comboName) parts.push(`combo/${comboName}`);
  if (selectedModel) parts.push(selectedModel);
  if (finalModel) parts.push(finalModel);
  const chain = uniqueStrings(parts);

  const normalized = {
    requestedModel,
    requestedAlias,
    comboName,
    tierName,
    selectedModel,
    resolvedProvider,
    resolvedModel,
    finalModel,
    attemptedModels,
    attempts,
    routeType:
      cleanString(route.routeType) ||
      cleanString(fallback.routeType) ||
      (comboName ? "combo" : "single"),
    terminalErrorClass:
      cleanString(route.terminalErrorClass) ||
      cleanString(fallback.terminalErrorClass),
    terminalErrorCode:
      cleanString(route.terminalErrorCode) ||
      cleanString(fallback.terminalErrorCode),
    chain,
  };

  normalized.summary = buildSummary(normalized);
  return normalized;
}

function buildSummary(route = {}) {
  const pieces = [];
  for (const item of route.chain || []) {
    if (!item || pieces[pieces.length - 1] === item) continue;
    pieces.push(item);
  }

  if (pieces.length === 0) {
    return route.finalModel || route.requestedModel || "Unknown route";
  }

  const summary = pieces.join(" -> ");
  return route.tierName ? `${summary} | ${route.tierName}` : summary;
}

export function buildRequestRouteSummary(route = {}) {
  const normalized = route?.chain ? route : normalizeRequestRoute(route);
  return buildSummary(normalized);
}
