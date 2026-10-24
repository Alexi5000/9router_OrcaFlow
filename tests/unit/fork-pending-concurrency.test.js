import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  for (const key of ["_pendingRequestEntries", "_pendingRequests", "_lastErrorProvider", "_statsEmitter", "_pendingTimers", "_recentRing", "_connectionMapCache", "_statsEmitTimers"]) delete global[key];
  vi.resetModules();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("finishing one request preserves a sibling timeout and ignores duplicate completion", async () => {
  const { trackPendingRequest } = await import("@/lib/db/repos/usageRepo.js");
  trackPendingRequest("model", "provider", "account", true, false, { requestId: "first" });
  vi.advanceTimersByTime(10000);
  trackPendingRequest("model", "provider", "account", true, false, { requestId: "second" });
  trackPendingRequest("model", "provider", "account", false, false, { requestId: "first" });
  trackPendingRequest("model", "provider", "account", false, false, { requestId: "first" });
  expect(global._pendingRequests.byModel["model (provider)"]).toBe(1);
  expect(Object.keys(global._pendingRequestEntries)).toEqual(["second"]);
  vi.advanceTimersByTime(60001);
  expect(global._pendingRequestEntries).toEqual({});
  expect(global._pendingRequests.byModel).toEqual({});
  expect(global._pendingRequests.byAccount).toEqual({});
});

it("tracks legacy callers without request IDs independently", async () => {
  const { trackPendingRequest } = await import("@/lib/db/repos/usageRepo.js");
  trackPendingRequest("model", "provider", "account", true);
  trackPendingRequest("model", "provider", "account", true);
  trackPendingRequest("model", "provider", "account", false);
  expect(Object.keys(global._pendingRequestEntries)).toHaveLength(1);
  vi.advanceTimersByTime(60001);
  expect(global._pendingRequests.byModel).toEqual({});
});
