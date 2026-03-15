import { describe, expect, it, vi } from "vitest";

import { getProviderCooldownOverride, getMsUntilNextHour } from "../../open-sse/services/accountFallback.js";

describe("Kilo hourly cooldown overrides", () => {
  it("locks Kilo free models until the next hour on 429s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T15:23:45.000Z"));

    expect(
      getProviderCooldownOverride({
        provider: "kilocode",
        model: "openrouter/healer-alpha",
        status: 429,
        errorText: "Kilo free model limit hit",
      })
    ).toBe(36 * 60 * 1000 + 15 * 1000);

    vi.useRealTimers();
  });

  it("prefers explicit retry-after timing when present", () => {
    expect(
      getProviderCooldownOverride({
        provider: "kilocode",
        model: "openrouter/hunter-alpha",
        status: 429,
        errorText: "Slow down",
        retryAfterMs: 15000,
      })
    ).toBe(15000);
  });

  it("computes the next hour boundary safely", () => {
    const now = new Date("2026-03-15T15:59:59.000Z").getTime();
    expect(getMsUntilNextHour(now)).toBe(1000);
  });
});
