import { describe, expect, it } from "vitest";

import {
  getEffectiveConnectionStatus,
  hasActiveModelLock,
  isGlobalProviderHealthError,
} from "../../src/shared/utils/providerHealth.js";

describe("providerHealth", () => {
  it("treats auth errors as global provider health failures", () => {
    expect(isGlobalProviderHealthError(401, "OAuth token has expired")).toBe(
      true,
    );
    expect(isGlobalProviderHealthError(403, "Forbidden")).toBe(true);
  });

  it("does not treat model-id errors as global provider health failures", () => {
    expect(
      isGlobalProviderHealthError(400, "hunter-alpha is not a valid model ID"),
    ).toBe(false);
    expect(
      isGlobalProviderHealthError(400, "[400]: Provider returned error"),
    ).toBe(false);
  });

  it("detects active model locks", () => {
    expect(
      hasActiveModelLock({
        "modelLock_openrouter/hunter-alpha": new Date(
          Date.now() + 30_000,
        ).toISOString(),
      }),
    ).toBe(true);
  });

  it("treats model-scoped cooldowns as active instead of unavailable", () => {
    expect(
      getEffectiveConnectionStatus({
        testStatus: "unavailable",
        errorCode: 400,
        lastError: "[400]: Provider returned error",
        "modelLock_openrouter/hunter-alpha": new Date(
          Date.now() + 30_000,
        ).toISOString(),
      }),
    ).toBe("active");
  });

  it("keeps auth failures unavailable", () => {
    expect(
      getEffectiveConnectionStatus({
        testStatus: "unavailable",
        errorCode: 401,
        lastError: "OAuth token has expired",
        "modelLock_claude-sonnet-4-6": new Date(
          Date.now() + 30_000,
        ).toISOString(),
      }),
    ).toBe("unavailable");
  });
});
