import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfoWithOptions, getComboConfig } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { HTTP_STATUS } from "open-sse/config/constants.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { classifyRequestFailure } from "@/shared/utils/requestFailure.js";
import { shapeDeepseekSwarmCombo } from "@/shared/utils/deepseekSwarmRouting.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { buildRequestDetail, extractRequestConfig } from "open-sse/handlers/chatCore/requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb";

function appendUniqueRouteAttempt(clientRawRequest, modelStr) {
  if (!clientRawRequest) return;
  if (!clientRawRequest.routing) clientRawRequest.routing = {};
  if (!Array.isArray(clientRawRequest.routing.attemptedModels)) {
    clientRawRequest.routing.attemptedModels = [];
  }

  if (typeof modelStr !== "string" || !modelStr.length) return;
  if (!clientRawRequest.routing.attemptedModels.includes(modelStr)) {
    clientRawRequest.routing.attemptedModels.push(modelStr);
  }
}

function updateClientRouting(clientRawRequest, patch = {}) {
  if (!clientRawRequest) return;
  const current = clientRawRequest.routing || {};
  const next = { ...current, ...patch };

  if (patch.attemptedModels || current.attemptedModels) {
    const attempts = [
      ...(Array.isArray(current.attemptedModels) ? current.attemptedModels : []),
      ...(Array.isArray(patch.attemptedModels) ? patch.attemptedModels : []),
    ].filter((value, index, list) => typeof value === "string" && value.length > 0 && list.indexOf(value) === index);
    next.attemptedModels = attempts;
  }

  if (patch.attempts || current.attempts) {
    next.attempts = [
      ...(Array.isArray(current.attempts) ? current.attempts : []),
      ...(Array.isArray(patch.attempts) ? patch.attempts : []),
    ];
  }

  clientRawRequest.routing = next;
}

function recordRouteAttempt(clientRawRequest, attempt = {}) {
  if (!clientRawRequest) return;

  updateClientRouting(clientRawRequest, {
    attempts: [{
      requestedModel: attempt.requestedModel || null,
      selectedModel: attempt.selectedModel || null,
      provider: attempt.provider || null,
      model: attempt.model || null,
      finalModel: attempt.finalModel || null,
      status: attempt.status || null,
      errorClass: attempt.errorClass || null,
      errorCode: attempt.errorCode || null,
      message: attempt.message || null,
      statusCode: attempt.statusCode || null,
      timestamp: attempt.timestamp || new Date().toISOString(),
    }],
  });
}

function setTerminalRouteError(clientRawRequest, errorClass = null, errorCode = null) {
  if (!clientRawRequest) return;
  updateClientRouting(clientRawRequest, {
    terminalErrorClass: errorClass,
    terminalErrorCode: errorCode,
  });
}

function saveTerminalFailureDetail({ body, provider = null, model = null, connectionId = null, clientRawRequest = null, statusCode, message, errorClass, errorCode = null }) {
  saveRequestDetail(buildRequestDetail({
    provider: provider || "router",
    model: model || body?.model || "unknown",
    connectionId,
    latency: { ttft: 0, total: 0 },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body || {}, Boolean(body?.stream)),
    providerRequest: null,
    providerResponse: null,
    response: { error: message, status: statusCode, thinking: null },
    status: "error",
    route: clientRawRequest?.routing,
    errorClass,
    errorCode,
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});
}

async function applyTerminalErrorFromResponse(clientRawRequest, response, fallback = {}) {
  if (!clientRawRequest || response?.ok) return;

  let message = fallback.message || "";
  let errorCode = fallback.errorCode || null;
  try {
    const payload = await response.clone().json();
    message = payload?.error?.message || payload?.message || message;
    errorCode = payload?.error?.code || errorCode;
  } catch {
    // Ignore non-JSON error bodies.
  }

  const errorClass = classifyRequestFailure({
    status: response.status,
    message,
    errorCode,
  });
  setTerminalRouteError(clientRawRequest, errorClass, errorCode);
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Validate messages field
  if (!body.messages && !body.input) {
    log.warn("CHAT", "Missing required field: messages");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: messages");
  }

  if (body.messages && !Array.isArray(body.messages)) {
    log.warn("CHAT", "messages must be an array");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "messages must be an array");
  }

  if (body.messages && body.messages.length === 0) {
    log.warn("CHAT", "messages array cannot be empty");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "messages array cannot be empty");
  }

  // Validate message format
  if (body.messages) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (!msg.role || typeof msg.role !== 'string') {
        log.warn("CHAT", `Invalid message format at index ${i}: missing or invalid 'role'`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `Invalid message format at index ${i}: each message must have a 'role' string`);
      }
      if (msg.content === undefined && !msg.tool_calls) {
        log.warn("CHAT", `Invalid message format at index ${i}: missing 'content'`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `Invalid message format at index ${i}: each message must have 'content'`);
      }
    }
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries()),
      routing: {
        requestedModel: body.model || null,
        routeType: "single",
        attemptedModels: [],
      },
    };
  }

  // Log request endpoint and model
  const url = new URL(request.url);
  const modelStr = body.model;

  // Count messages (support both messages[] and input[] formats)
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`);

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Check if model is a combo (has multiple models with fallback)
  const comboConfig = await getComboConfig(modelStr);
  const combo = shapeDeepseekSwarmCombo(comboConfig, body);
  if (combo?.models?.length) {
    log.info("CHAT", `Combo "${modelStr}" with ${combo.models.length} models`);
    updateClientRouting(clientRawRequest, {
      requestedModel: body.model || modelStr,
      comboName: combo.name || modelStr,
      routeType: "combo",
    });
    const comboResponse = await handleComboChat({
      body,
      models: combo.models,
      combo,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      onTierStart: (tier) => {
        updateClientRouting(clientRawRequest, {
          comboName: combo.name || modelStr,
          tierName: tier?.name || null,
        });
      },
      onModelAttempt: ({ modelStr: attemptedModel, tier }) => {
        appendUniqueRouteAttempt(clientRawRequest, attemptedModel);
        updateClientRouting(clientRawRequest, {
          comboName: combo.name || modelStr,
          tierName: tier?.name || null,
          selectedModel: attemptedModel,
        });
      },
      log
    });
    await applyTerminalErrorFromResponse(clientRawRequest, comboResponse);
    return comboResponse;
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null) {
  appendUniqueRouteAttempt(clientRawRequest, modelStr);
  const modelInfo = await getModelInfoWithOptions(modelStr, {
    resolveClientPrefixedAliases: !clientRawRequest?.routing?.comboName,
  });

  // If provider is null, this might be a combo name - check and handle
  // Use modelInfo.model (alias-resolved) not modelStr (original), since aliases can point to combo names
  if (!modelInfo.provider) {
    const comboName = modelInfo.model || modelStr;
    const comboConfig = await getComboConfig(comboName);
    const combo = shapeDeepseekSwarmCombo(comboConfig, body);
    if (combo?.models?.length) {
      log.info("CHAT", `Combo "${comboName}" with ${combo.models.length} models (from ${modelStr})`);
      updateClientRouting(clientRawRequest, {
        requestedModel: clientRawRequest?.routing?.requestedModel || body.model || modelStr,
        requestedAlias: modelStr,
        comboName,
        routeType: "combo",
      });
      const comboResponse = await handleComboChat({
        body,
        models: combo.models,
        combo,
        handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        onTierStart: (tier) => {
          updateClientRouting(clientRawRequest, {
            comboName,
            tierName: tier?.name || null,
          });
        },
        onModelAttempt: ({ modelStr: attemptedModel, tier }) => {
          appendUniqueRouteAttempt(clientRawRequest, attemptedModel);
          updateClientRouting(clientRawRequest, {
            comboName,
            tierName: tier?.name || null,
            selectedModel: attemptedModel,
          });
        },
        log
      });
      await applyTerminalErrorFromResponse(clientRawRequest, comboResponse);
      return comboResponse;
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    const errorClass = classifyRequestFailure({
      status: HTTP_STATUS.BAD_REQUEST,
      message: "Invalid model format",
    });
    setTerminalRouteError(clientRawRequest, errorClass, null);
    saveTerminalFailureDetail({
      body,
      clientRawRequest,
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: "Invalid model format",
      errorClass,
    });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Log model routing (alias → actual model)
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }
  updateClientRouting(clientRawRequest, {
    requestedModel: clientRawRequest?.routing?.requestedModel || body.model || modelStr,
    requestedAlias: modelStr !== `${provider}/${model}` ? modelStr : (clientRawRequest?.routing?.requestedAlias || null),
    selectedModel: modelStr,
    resolvedProvider: provider,
    resolvedModel: model,
    finalModel: `${provider}/${model}`,
    routeType: clientRawRequest?.routing?.comboName ? "combo" : "single",
  });

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  let excludeConnectionId = null;
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionId, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        const errorClass = classifyRequestFailure({
          status,
          message: errorMsg,
          errorCode: credentials.lastErrorCode,
        });
        recordRouteAttempt(clientRawRequest, {
          requestedModel: modelStr,
          selectedModel: modelStr,
          provider,
          model,
          finalModel: `${provider}/${model}`,
          status: "failed",
          statusCode: status,
          errorClass,
          errorCode: credentials.lastErrorCode || null,
          message: errorMsg,
        });
        setTerminalRouteError(clientRawRequest, errorClass, credentials.lastErrorCode || null);
        saveTerminalFailureDetail({
          body,
          provider,
          model,
          clientRawRequest,
          statusCode: status,
          message: errorMsg,
          errorClass,
          errorCode: credentials.lastErrorCode || null,
        });
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (!excludeConnectionId) {
        const errorClass = classifyRequestFailure({
          status: HTTP_STATUS.BAD_REQUEST,
          message: `No credentials for provider: ${provider}`,
        });
        recordRouteAttempt(clientRawRequest, {
          requestedModel: modelStr,
          selectedModel: modelStr,
          provider,
          model,
          finalModel: `${provider}/${model}`,
          status: "failed",
          statusCode: HTTP_STATUS.BAD_REQUEST,
          errorClass,
          message: `No credentials for provider: ${provider}`,
        });
        setTerminalRouteError(clientRawRequest, errorClass, null);
        saveTerminalFailureDetail({
          body,
          provider,
          model,
          clientRawRequest,
          statusCode: HTTP_STATUS.BAD_REQUEST,
          message: `No credentials for provider: ${provider}`,
          errorClass,
        });
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      const errorClass = classifyRequestFailure({
        status: lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
        message: lastError || "All accounts unavailable",
      });
      recordRouteAttempt(clientRawRequest, {
        requestedModel: modelStr,
        selectedModel: modelStr,
        provider,
        model,
        finalModel: `${provider}/${model}`,
        status: "failed",
        statusCode: lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
        errorClass,
        message: lastError || "All accounts unavailable",
      });
      setTerminalRouteError(clientRawRequest, errorClass, null);
      saveTerminalFailureDetail({
        body,
        provider,
        model,
        clientRawRequest,
        statusCode: lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
        message: lastError || "All accounts unavailable",
        errorClass,
      });
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Log account selection
    const accountId = credentials.connectionId.slice(0, 8);
    log.info("AUTH", `Using ${provider} account: ${accountId}...`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

    if (result.success) {
      recordRouteAttempt(clientRawRequest, {
        requestedModel: modelStr,
        selectedModel: modelStr,
        provider,
        model,
        finalModel: `${provider}/${model}`,
        status: "success",
        statusCode: 200,
      });
      setTerminalRouteError(clientRawRequest, null, null);
      return result.response;
    }

    if (result.skipProviderCooldown) {
      log.warn("AUTH", `Skipping provider cooldown for ${provider}/${model} (${result.errorCode || "request-scoped error"})`);
      const errorClass = classifyRequestFailure({
        status: result.status,
        message: result.error,
        errorCode: result.errorCode,
        requestScopedFallback: result.requestScopedFallback,
      });
      recordRouteAttempt(clientRawRequest, {
        requestedModel: modelStr,
        selectedModel: modelStr,
        provider,
        model,
        finalModel: `${provider}/${model}`,
        status: "failed",
        statusCode: result.status,
        errorClass,
        errorCode: result.errorCode || null,
        message: result.error,
      });
      setTerminalRouteError(clientRawRequest, errorClass, result.errorCode || null);
      return result.response;
    }

    // Mark account unavailable (auto-calculates cooldown with exponential backoff)
    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,
      result.status,
      result.error,
      provider,
      model,
      result.retryAfterMs || null
    );

    if (shouldFallback) {
      recordRouteAttempt(clientRawRequest, {
        requestedModel: modelStr,
        selectedModel: modelStr,
        provider,
        model,
        finalModel: `${provider}/${model}`,
        status: "failed",
        statusCode: result.status,
        errorClass: classifyRequestFailure({
          status: result.status,
          message: result.error,
          errorCode: result.errorCode,
        }),
        errorCode: result.errorCode || null,
        message: result.error,
      });
      log.warn("AUTH", `Account ${accountId}... unavailable (${result.status}), trying fallback`);
      excludeConnectionId = credentials.connectionId;
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    const terminalErrorClass = classifyRequestFailure({
      status: result.status,
      message: result.error,
      errorCode: result.errorCode,
    });
    recordRouteAttempt(clientRawRequest, {
      requestedModel: modelStr,
      selectedModel: modelStr,
      provider,
      model,
      finalModel: `${provider}/${model}`,
      status: "failed",
      statusCode: result.status,
      errorClass: terminalErrorClass,
      errorCode: result.errorCode || null,
      message: result.error,
    });
    setTerminalRouteError(clientRawRequest, terminalErrorClass, result.errorCode || null);
    return result.response;
  }
}
