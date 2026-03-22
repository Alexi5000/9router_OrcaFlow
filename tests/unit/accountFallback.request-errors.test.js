import { describe, expect, it } from "vitest";

import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { COOLDOWN_MS } from "../../open-sse/config/constants.js";

describe("request-scoped 400 errors", () => {
  it("does not fallback or cooldown for invalid model IDs", () => {
    expect(
      checkFallbackError(400, "hunter-alpha is not a valid model ID"),
    ).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("does not fallback or cooldown for generic bad requests", () => {
    expect(checkFallbackError(400, "Invalid JSON body")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("still falls back for transient provider 400s", () => {
    expect(checkFallbackError(400, "[400]: Provider returned error")).toEqual({
      shouldFallback: true,
      cooldownMs: COOLDOWN_MS.transient,
    });
  });

  it("still falls back for request-not-allowed account errors", () => {
    expect(
      checkFallbackError(400, "Request not allowed for this account"),
    ).toEqual({
      shouldFallback: true,
      cooldownMs: COOLDOWN_MS.requestNotAllowed,
    });
  });
});
