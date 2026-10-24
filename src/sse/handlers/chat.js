import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfoWithOptions, getComboConfig } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { resolveSessionIdentity } from "open-sse/utils/sessionManager.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { getKeyAccessContext, enforceKeyAccess, filterAdapterModels } from "../services/keyAccess.js";
import { resolveSmartChoice } from "../services/systemoneRouter.js";
import { classifyRequestFailure } from "@/shared/utils/requestFailure.js";
import { shapeDeepseekSwarmCombo } from "@/shared/utils/deepseekSwarmRouting.js";
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
  if (!body?.messages && !body?.input && !body?.contents && !body?.request?.contents) {
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
      if (!msg || !msg.role || typeof msg.role !== 'string') {
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
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  const session = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
  const sessionId = session?.sessionId || null;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

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

  // Per-key access control: a restricted key may call only its listed combos and
  // models. Checked once on the requested target, before bypass, combo expansion
  // and any credential lookup; an allowed combo grants the members it routes to.
  const keyAccess = await getKeyAccessContext(request);
  const keyAccessDenied = await enforceKeyAccess(keyAccess, modelStr);
  if (keyAccessDenied) return keyAccessDenied;

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboConfig = await getComboConfig(modelStr);
  const combo = shapeDeepseekSwarmCombo(comboConfig, body);
  const comboModels = combo?.models;
  if (comboModels?.length) {
    updateClientRouting(clientRawRequest, { requestedModel: clientRawRequest?.routing?.requestedModel || body.model || modelStr, comboName: combo.name || modelStr, routeType: "combo" });
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const augmentedModels = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings), comboModels);
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    const comboCfg = comboStrategies[modelStr] || {};
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    const comboResponse = await handleComboChat({
      body,
      models: augmentedModels,
      combo,
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

      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
      sessionId,
      smartPolicy: comboCfg.smartPolicy || "smart",
      sessionSticky: comboCfg.sessionSticky !== false,
      confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
      resolveSmartChoice: comboStrategy === "smart"
        ? (b, m) => resolveSmartChoice({
            body: b,
            models: m,
            routerModel: comboCfg.routerModel,
            log,
          })
        : null,
    });
    await applyTerminalErrorFromResponse(clientRawRequest, comboResponse);
    return comboResponse;
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings), [modelStr]);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, contextMarker ? `${modelStr.slice(modelStr.indexOf("/") + 1)}[${contextMarker}]` : null);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, requestedModel = null) {
  appendUniqueRouteAttempt(clientRawRequest, modelStr);
  const modelInfo = await getModelInfoWithOptions(modelStr, {
    resolveClientPrefixedAliases: !clientRawRequest?.routing?.comboName,
  });

  // If provider is null, this might be a combo name - check and handle
  // Use modelInfo.model (alias-resolved) not modelStr (original), since aliases can point to combo names
  if (!modelInfo.provider) {
    const comboName = modelInfo.model || modelStr;
    const comboConfig = await getComboConfig(modelInfo.model || modelStr);
    const combo = shapeDeepseekSwarmCombo(comboConfig, body);
    const comboModels = combo?.models;
    if (comboModels?.length) {
      updateClientRouting(clientRawRequest, { requestedModel: clientRawRequest?.routing?.requestedModel || body.model || modelStr, comboName: combo.name || modelStr, routeType: "combo" });
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      // Nested combo (a combo member that is itself a combo): the access decision
      // was made on the outer target; only drop adapter models the key may not call.
      const keyAccess = await getKeyAccessContext(request);
      const augmentedModels = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings), comboModels);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      const comboCfg = comboStrategies[modelStr] || {};
      const nestedSession = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
      const nestedSessionId = nestedSession?.sessionId || null;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      const comboResponse = await handleComboChat({
        body,
        models: augmentedModels,
        combo,
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

        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        sessionId: nestedSessionId,
        smartPolicy: comboCfg.smartPolicy || "smart",
        sessionSticky: comboCfg.sessionSticky !== false,
        confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
        resolveSmartChoice: comboStrategy === "smart"
          ? (b, m) => resolveSmartChoice({
              body: b,
              models: m,
              routerModel: comboCfg.routerModel,
              log,
            })
          : null,
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
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { requestedModel: requestedModel || model });

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
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders);
      }
      if (excludeConnectionIds.size === 0) {
        const errorClass = classifyRequestFailure({
          status: HTTP_STATUS.NOT_FOUND,
          message: `No active credentials for provider: ${provider}`,
        });
        recordRouteAttempt(clientRawRequest, {
          requestedModel: modelStr,
          selectedModel: modelStr,
          provider,
          model,
          finalModel: `${provider}/${model}`,
          status: "failed",
          statusCode: HTTP_STATUS.NOT_FOUND,
          errorClass,
          message: `No active credentials for provider: ${provider}`,
        });
        setTerminalRouteError(clientRawRequest, errorClass, null);
        saveTerminalFailureDetail({
          body,
          provider,
          model,
          clientRawRequest,
          statusCode: HTTP_STATUS.NOT_FOUND,
          message: `No active credentials for provider: ${provider}`,
          errorClass,
        });
        log.error("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
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
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      customPromptEnabled: !!chatSettings.customPromptEnabled,
      customPrompt: chatSettings.customPrompt || "",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Per-provider user overrides (custom headers / connect timeout) from settings
      providerOverrides: (chatSettings.providerOverrides || {})[provider] || null,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
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

    // Antigravity 409/429: refresh live quota to get exact resetAt before locking
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

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

      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
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
