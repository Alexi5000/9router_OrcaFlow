import { HTTP_STATUS, RETRY_CONFIG } from "../config/constants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { 
  createTimeoutController, 
  parseRetryAfterHeader, 
  classifyError,
  TIMEOUT_CONFIG 
} from "../utils/requestUtils.js";

/**
 * BaseExecutor - Base class for provider executors
 * Enhanced with request timeout and improved error handling
 */
export class BaseExecutor {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.timeoutMs = config?.timeoutMs || TIMEOUT_CONFIG.defaultMs;
  }

  getProvider() {
    return this.provider;
  }

  getBaseUrls() {
    return this.config.baseUrls || (this.config.baseUrl ? [this.config.baseUrl] : []);
  }

  getFallbackCount() {
    return this.getBaseUrls().length || 1;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    } else if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  // Override in subclass for provider-specific transformations
  transformRequest(model, body, stream, credentials) {
    return body;
  }

  shouldRetry(status, urlIndex) {
    return status === HTTP_STATUS.RATE_LIMITED && urlIndex + 1 < this.getFallbackCount();
  }

  // Override in subclass for provider-specific refresh
  async refreshCredentials(credentials, log) {
    return null;
  }

  needsRefresh(credentials) {
    if (!credentials.expiresAt) return false;
    const expiresAtMs = new Date(credentials.expiresAt).getTime();
    return expiresAtMs - Date.now() < 5 * 60 * 1000;
  }

  parseError(response, bodyText) {
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const retryAttemptsByUrl = {};

    // Create timeout controller (can be aborted by client signal too)
    const timeoutController = createTimeoutController(this.timeoutMs);
    const combinedSignal = signal 
      ? this._combineSignals([signal, timeoutController.controller.signal], log)
      : timeoutController.controller.signal;

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const headers = this.buildHeaders(credentials, stream);
      const transformedBody = this.transformRequest(model, body, stream, credentials);

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      try {
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal: combinedSignal
        }, proxyOptions);

        // Parse Retry-After header if present
        const retryAfterMs = parseRetryAfterHeader(response);
        
        // Enhanced 429 handling with Retry-After support
        if (response.status === HTTP_STATUS.RATE_LIMITED && retryAttemptsByUrl[urlIndex] < RETRY_CONFIG.maxAttempts) {
          retryAttemptsByUrl[urlIndex]++;
          const delay = retryAfterMs || RETRY_CONFIG.delayMs;
          log?.debug?.("RETRY", `429 retry ${retryAttemptsByUrl[urlIndex]}/${RETRY_CONFIG.maxAttempts} after ${Math.ceil(delay / 1000)}s${retryAfterMs ? ' (Retry-After)' : ''}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          urlIndex--;
          continue;
        }

        // Use improved error classification for fallback decisions
        if (!response.ok) {
          const classification = classifyError(response.status);
          
          if (!classification.shouldFallback) {
            // Client error - don't retry, return immediately
            return { response, url, headers, transformedBody };
          }
          
          if (this.shouldRetry(response.status, urlIndex)) {
            log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
            lastStatus = response.status;
            continue;
          }
        }

        timeoutController.clear();
        return { response, url, headers, transformedBody };
      } catch (error) {
        lastError = error;
        
        // Handle timeout errors specifically
        if (error.name === "AbortError" && error.message?.includes("timeout")) {
          log?.warn?.("TIMEOUT", `Request to ${url} timed out after ${this.timeoutMs}ms`);
        }
        
        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        
        timeoutController.clear();
        throw error;
      }
    }

    timeoutController.clear();
    throw lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
  }

  /**
   * Combine multiple abort signals
   * @private
   */
  _combineSignals(signals, log) {
    const controller = new AbortController();
    
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      signal.addEventListener("abort", () => {
        controller.abort(signal.reason);
      });
    }
    
    return controller.signal;
  }
}

export default BaseExecutor;
