import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
  })),
}));

vi.mock("open-sse/services/accountFallback.js", () => ({
  formatRetryAfter: vi.fn(() => "reset after 30s"),
  checkFallbackError: vi.fn(() => ({ shouldFallback: true, cooldownMs: 1000, newBackoffLevel: 1 })),
  isModelLockActive: vi.fn(() => false),
  buildModelLockUpdate: vi.fn(() => ({ modelLock___all: new Date(Date.now() + 1000).toISOString() })),
  getEarliestModelLockUntil: vi.fn(() => null),
  getProviderCooldownOverride: vi.fn(() => null),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: vi.fn((provider) => provider),
}));

vi.mock("@/shared/utils/providerHealth.js", () => ({
  getEffectiveConnectionStatus: vi.fn((connection) => connection.testStatus),
  isGlobalProviderHealthError: vi.fn(() => false),
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { getProviderCredentials } from "../../src/sse/services/auth.js";
import { getProviderConnections, getSettings } from "@/lib/localDb";

describe("provider credential selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockResolvedValue({ fallbackStrategy: "fill-first" });
  });

  it("skips connections that are globally unavailable even when they are active", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([
      {
        id: "bad-conn",
        provider: "claude",
        isActive: true,
        testStatus: "unavailable",
        lastError: "Invalid authentication credentials",
        errorCode: 401,
        priority: 1,
        providerSpecificData: {},
      },
      {
        id: "good-conn",
        provider: "claude",
        isActive: true,
        testStatus: "active",
        priority: 2,
        providerSpecificData: {},
        accessToken: "token",
      },
    ]);

    const credentials = await getProviderCredentials("claude", null, "claude-sonnet-4-6");

    expect(credentials.connectionId).toBe("good-conn");
  });
});
