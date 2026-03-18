// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";

export { parseModel };

function flattenComboModels(combo) {
  if (Array.isArray(combo?.models) && combo.models.length > 0) {
    return combo.models;
  }

  if (!Array.isArray(combo?.tiers)) {
    return [];
  }

  return combo.tiers.flatMap((tier) => Array.isArray(tier?.models) ? tier.models : []);
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  return getModelInfoWithOptions(modelStr, {});
}

export async function getModelInfoWithOptions(modelStr, options = {}) {
  const parsed = parseModel(modelStr);
  const aliases = await getModelAliases();

  if (!parsed.isAlias) {
    const resolvedPrefixedAlias = resolveModelAliasFromMap(parsed.model, aliases);
    if (
      resolvedPrefixedAlias &&
      (
        (parsed.providerAlias && parsed.providerAlias !== parsed.provider) ||
        (
          options.resolveClientPrefixedAliases === true &&
          (parsed.providerAlias === "claude" || parsed.providerAlias === "cc" || parsed.provider === "claude")
        )
      )
    ) {
      return resolvedPrefixedAlias;
    }

    if (parsed.provider === parsed.providerAlias) {
      // Check OpenAI Compatible nodes
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      // Check Anthropic Compatible nodes
      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  // Resolve alias first — if alias points to a combo name (bare string, no "/"),
  // we need to check if the resolved value is a combo before falling through
  const aliasValue = aliases?.[parsed.model];
  if (typeof aliasValue === "string" && !aliasValue.includes("/")) {
    const aliasCombo = await getComboByName(aliasValue);
    if (aliasCombo) {
      return { provider: null, model: aliasValue };
    }
  }

  return getModelInfoCore(modelStr, getModelAliases, options);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  const combo = await getComboConfig(modelStr);
  return combo?.models || null;
}

/**
 * Get full combo config if model is a combo name
 * @returns {Promise<object|null>}
 */
export async function getComboConfig(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo) {
    const models = flattenComboModels(combo);
    if (models.length > 0) {
      return {
        ...combo,
        models,
      };
    }
  }
  return null;
}
