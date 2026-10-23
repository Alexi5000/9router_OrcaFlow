/**
 * Stored API-key access checks shared by cloud inference and verify handlers.
 *
 * Mirrors the local validator (src/lib/localDb.js validateApiKey): a key is
 * accepted only when an exact stored record exists and that record is not
 * disabled. Records with isActive === false are treated as revoked.
 */

/**
 * @param {Array<{key?: string, isActive?: boolean}>|undefined|null} apiKeys
 * @param {string|undefined|null} apiKey
 * @returns {boolean}
 */
export function isActiveStoredApiKey(apiKeys, apiKey) {
  if (typeof apiKey !== "string" || apiKey.length === 0) return false;
  if (!Array.isArray(apiKeys)) return false;
  return apiKeys.some(
    (record) => record && record.key === apiKey && record.isActive !== false
  );
}
