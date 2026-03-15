/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";

if (!globalThis._comboRoutingState) {
  globalThis._comboRoutingState = {};
}

const comboRoutingState = globalThis._comboRoutingState;

function buildWeightedOrder(models, routingConfig, log, routingKey = null) {
  const trafficShare = routingConfig?.trafficShare;
  if (!trafficShare || typeof trafficShare !== "object" || Array.isArray(trafficShare)) {
    return models;
  }

  const weightedModels = [];
  const weightedUnique = [];

  for (const model of models) {
    const weight = Math.floor(Number(trafficShare[model] || 0));
    if (weight <= 0) continue;
    weightedUnique.push(model);
    for (let i = 0; i < weight; i++) {
      weightedModels.push(model);
    }
  }

  if (weightedModels.length === 0 || weightedUnique.length < 2) {
    return models;
  }

  const comboKey = routingKey || routingConfig?.name || routingConfig?.id || models.join("|");
  const cursor = comboRoutingState[comboKey] || 0;
  const selected = weightedModels[cursor % weightedModels.length];
  comboRoutingState[comboKey] = (cursor + 1) % weightedModels.length;

  const weightedFallback = weightedUnique.filter((model) => model !== selected);
  const remaining = models.filter((model) => !weightedUnique.includes(model));
  const ordered = [selected, ...weightedFallback, ...remaining];

  log?.info?.(
    "COMBO",
    `Weighted primary ${selected} (${(cursor % weightedModels.length) + 1}/${weightedModels.length})`
  );

  return ordered;
}

function getComboTiers(combo, models, log) {
  const configuredTiers = Array.isArray(combo?.tiers) ? combo.tiers : null;

  if (!configuredTiers?.length) {
    return [
      {
        name: combo?.name || "default",
        models: buildWeightedOrder(models, combo, log),
      },
    ];
  }

  const tiers = configuredTiers
    .map((tier, index) => {
      const tierModels = Array.isArray(tier?.models)
        ? tier.models.filter((model) => typeof model === "string" && model.length > 0)
        : [];

      if (!tierModels.length) return null;

      const tierName = tier?.name || `tier-${index + 1}`;
      return {
        name: tierName,
        models: buildWeightedOrder(
          tierModels,
          tier,
          log,
          `${combo?.name || combo?.id || "combo"}:${tierName}`
        ),
      };
    })
    .filter(Boolean);

  if (tiers.length > 0) {
    return tiers;
  }

  return [
    {
      name: combo?.name || "default",
      models: buildWeightedOrder(models, combo, log),
    },
  ];
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;
  
  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find(c => c.name === modelStr);
  if (!combo) {
    return null;
  }

  if (Array.isArray(combo.models) && combo.models.length > 0) {
    return combo.models;
  }

  if (Array.isArray(combo.tiers)) {
    const tierModels = combo.tiers.flatMap((tier) => Array.isArray(tier?.models) ? tier.models : []);
    return tierModels.length > 0 ? tierModels : null;
  }

  return null;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, combo = null }) {
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;
  const tiers = getComboTiers(combo, models, log);
  const orderedModels = tiers.flatMap((tier) => tier.models);
  let modelIndex = 0;

  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
    const tier = tiers[tierIndex];
    log.info("COMBO", `Tier ${tierIndex + 1}/${tiers.length}: ${tier.name}`);

    for (const modelStr of tier.models) {
      modelIndex += 1;
      log.info("COMBO", `Trying model ${modelIndex}/${orderedModels.length}: ${modelStr}`);

      try {
        const result = await handleSingleModel(body, modelStr);
      
        // Success (2xx) - return response
        if (result.ok) {
          log.info("COMBO", `Model ${modelStr} succeeded`);
          return result;
        }

        // Extract error info from response
        let errorText = result.statusText || "";
        let retryAfter = null;
        try {
          const errorBody = await result.clone().json();
          errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
          retryAfter = errorBody?.retryAfter || null;
        } catch {
          // Ignore JSON parse errors
        }

        // Track earliest retryAfter across all combo models
        if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
          earliestRetryAfter = retryAfter;
        }

        // Normalize error text to string (Worker-safe)
        if (typeof errorText !== "string") {
          try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
        }

        // Check if should fallback to next model
        const { shouldFallback } = checkFallbackError(result.status, errorText);
      
        if (!shouldFallback) {
          log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
          return result;
        }

        // Fallback to next model
        lastError = errorText || String(result.status);
        if (!lastStatus) lastStatus = result.status;
        log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
      } catch (error) {
        // Catch unexpected exceptions to ensure fallback continues
        lastError = error.message || String(error);
        if (!lastStatus) lastStatus = 500;
        log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
      }
    }
  }

  // All models failed
  const status =  406;
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}
