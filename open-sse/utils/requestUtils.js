/**
 * Request timeout and error handling utilities
 * Implements: AbortController timeout, Retry-After parsing, error classification
 */

import { HTTP_STATUS } from "../config/constants.js";

// Default timeout values
export const TIMEOUT_CONFIG = {
  defaultMs: 60000,        // 60 seconds default
  streamingMs: 300000,     // 5 minutes for streaming
  maxRetries: 3,
  retryDelayMs: 1000,
  maxRetryDelayMs: 60000,
};

/**
 * Error classification for fallback decisions
 */
export const ERROR_CLASSIFICATION = {
  // No fallback - client errors
  NO_FALLBACK: {
    statuses: [HTTP_STATUS.BAD_REQUEST], // 400
    patterns: [/invalid.*model/i, /not supported/i, /unsupported/i]
  },
  
  // Short cooldown, try next provider
  SHORT_COOLDOWN: {
    statuses: [HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN], // 401, 403
    cooldownMs: 2 * 60 * 1000, // 2 minutes
  },
  
  // Exponential backoff
  RATE_LIMITED: {
    statuses: [HTTP_STATUS.RATE_LIMITED], // 429
    baseCooldownMs: 1000,
    maxCooldownMs: 2 * 60 * 1000, // 2 minutes max
  },
  
  // Immediate fallback
  SERVER_ERROR: {
    statuses: [500, 502, 503, 504],
    cooldownMs: 60 * 1000, // 1 minute
  },
  
  // Not found - short cooldown
  NOT_FOUND: {
    statuses: [HTTP_STATUS.NOT_FOUND], // 404
    cooldownMs: 2 * 60 * 1000, // 2 minutes
  },
};

/**
 * Create an AbortController with automatic timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {{ controller: AbortController, clear: Function }}
 */
export function createTimeoutController(timeoutMs = TIMEOUT_CONFIG.defaultMs) {
  const controller = new AbortController();
  let timeoutId = null;
  let cleared = false;

  const clear = () => {
    if (cleared) return;
    cleared = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  timeoutId = setTimeout(() => {
    if (!cleared) {
      controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
    }
  }, timeoutMs);

  return { controller, clear };
}

/**
 * Parse Retry-After header from response
 * @param {Response} response - Fetch response
 * @returns {number|null} - Retry delay in milliseconds, or null if not present
 */
export function parseRetryAfterHeader(response) {
  const retryAfter = response.headers?.get?.("Retry-After");
  if (!retryAfter) return null;

  // Check if it's a number (seconds)
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Check if it's a date string
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const delay = date.getTime() - Date.now();
    return delay > 0 ? delay : null;
  }

  return null;
}

/**
 * Classify error and determine fallback behavior
 * @param {number} status - HTTP status code
 * @param {string} message - Error message
 * @returns {{ shouldFallback: boolean, cooldownMs: number, classification: string }}
 */
export function classifyError(status, message = "") {
  // Check for no-fallback patterns first
  if (ERROR_CLASSIFICATION.NO_FALLBACK.patterns.some(p => p.test(message))) {
    return {
      shouldFallback: false,
      cooldownMs: 0,
      classification: "client_error_pattern",
    };
  }

  // Check status codes
  if (ERROR_CLASSIFICATION.NO_FALLBACK.statuses.includes(status)) {
    return {
      shouldFallback: false,
      cooldownMs: 0,
      classification: "client_error",
    };
  }

  if (ERROR_CLASSIFICATION.SHORT_COOLDOWN.statuses.includes(status)) {
    return {
      shouldFallback: true,
      cooldownMs: ERROR_CLASSIFICATION.SHORT_COOLDOWN.cooldownMs,
      classification: "auth_error",
    };
  }

  if (status === HTTP_STATUS.RATE_LIMITED) {
    return {
      shouldFallback: true,
      cooldownMs: ERROR_CLASSIFICATION.RATE_LIMITED.baseCooldownMs,
      classification: "rate_limited",
      useExponentialBackoff: true,
    };
  }

  if (ERROR_CLASSIFICATION.SERVER_ERROR.statuses.includes(status)) {
    return {
      shouldFallback: true,
      cooldownMs: ERROR_CLASSIFICATION.SERVER_ERROR.cooldownMs,
      classification: "server_error",
    };
  }

  if (ERROR_CLASSIFICATION.NOT_FOUND.statuses.includes(status)) {
    return {
      shouldFallback: true,
      cooldownMs: ERROR_CLASSIFICATION.NOT_FOUND.cooldownMs,
      classification: "not_found",
    };
  }

  // Default: fallback with short cooldown
  return {
    shouldFallback: true,
    cooldownMs: 60 * 1000, // 1 minute
    classification: "unknown",
  };
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} baseMs - Base delay in milliseconds
 * @param {number} maxMs - Maximum delay in milliseconds
 * @returns {number} - Delay in milliseconds
 */
export function calculateBackoff(attempt, baseMs = 1000, maxMs = 60000) {
  // Exponential backoff with jitter
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = delay * 0.2 * Math.random(); // 20% jitter
  return Math.floor(delay + jitter);
}

/**
 * Check if error is retryable
 * @param {Error} error - Error object
 * @returns {boolean}
 */
export function isRetryableError(error) {
  // Network errors
  if (error.name === "AbortError") return false;
  if (error.code === "ECONNRESET") return true;
  if (error.code === "ETIMEDOUT") return true;
  if (error.code === "ENOTFOUND") return false;
  
  // Fetch errors
  if (error.message?.includes("fetch failed")) return true;
  if (error.message?.includes("network")) return true;
  
  return false;
}

/**
 * Create a wrapper for fetch with timeout and retry support
 * @param {object} options
 * @param {number} options.timeoutMs - Request timeout
 * @param {number} options.maxRetries - Maximum retry attempts
 * @param {function} options.onRetry - Callback before retry
 */
export function createResilientFetch({ 
  timeoutMs = TIMEOUT_CONFIG.defaultMs,
  maxRetries = TIMEOUT_CONFIG.maxRetries,
  onRetry = null
} = {}) {
  return async function resilientFetch(url, options = {}) {
    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const { controller, clear } = createTimeoutController(timeoutMs);
      
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        
        clear();
        
        // Check for retryable status codes
        if (!response.ok && attempt < maxRetries) {
          const classification = classifyError(response.status);
          
          if (classification.shouldFallback) {
            const retryAfter = parseRetryAfterHeader(response);
            const delay = retryAfter || calculateBackoff(attempt);
            
            if (onRetry) {
              await onRetry({ attempt, delay, status: response.status });
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        return response;
      } catch (error) {
        clear();
        lastError = error;
        
        if (attempt < maxRetries && isRetryableError(error)) {
          const delay = calculateBackoff(attempt);
          
          if (onRetry) {
            await onRetry({ attempt, delay, error });
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError || new Error("Max retries exceeded");
  };
}
