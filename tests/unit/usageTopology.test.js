import { describe, expect, it } from "vitest";
import { getRecentLastProvider, getRecentProvidersFromRequests } from "../../src/shared/utils/usageTopology.js";

describe("usage topology freshness", () => {
  const now = new Date("2026-03-16T03:32:00.000Z").getTime();

  it("only includes providers inside the freshness window", () => {
    const requests = [
      { provider: "kilocode", timestamp: "2026-03-16T03:31:45.000Z" },
      { provider: "claude", timestamp: "2026-03-16T03:31:10.000Z" },
      { provider: "codex", timestamp: "2026-03-16T03:30:29.000Z" },
      { provider: "groq", timestamp: "2026-03-16T03:31:20.000Z" },
      { provider: "kilocode", timestamp: "2026-03-16T03:31:00.000Z" },
    ];

    expect(getRecentProvidersFromRequests(requests, now, 90 * 1000, 4)).toEqual([
      "kilocode",
      "claude",
      "groq",
    ]);
  });

  it("limits the recent provider list and deduplicates provider ids", () => {
    const requests = [
      { provider: "kilocode", timestamp: "2026-03-16T03:31:59.000Z" },
      { provider: "claude", timestamp: "2026-03-16T03:31:58.000Z" },
      { provider: "codex", timestamp: "2026-03-16T03:31:57.000Z" },
      { provider: "groq", timestamp: "2026-03-16T03:31:56.000Z" },
      { provider: "github", timestamp: "2026-03-16T03:31:55.000Z" },
      { provider: "kilocode", timestamp: "2026-03-16T03:31:54.000Z" },
    ];

    expect(getRecentProvidersFromRequests(requests, now, 90 * 1000, 4)).toEqual([
      "kilocode",
      "claude",
      "codex",
      "groq",
    ]);
  });

  it("only keeps lastProvider while it is still fresh", () => {
    const fresh = [{ provider: "kilocode", timestamp: "2026-03-16T03:31:50.000Z" }];
    const stale = [{ provider: "kilocode", timestamp: "2026-03-16T03:30:00.000Z" }];

    expect(getRecentLastProvider(fresh, now, 90 * 1000)).toBe("kilocode");
    expect(getRecentLastProvider(stale, now, 90 * 1000)).toBe("");
  });
});
