import { describe, expect, it } from "vitest";

import {
  classifyRequestFailure,
  REQUEST_FAILURE_CLASSES,
} from "../../src/shared/utils/requestFailure.js";

describe("classifyRequestFailure", () => {
  it("classifies missing provider credentials as provider auth failure", () => {
    expect(classifyRequestFailure({
      status: 400,
      message: "No credentials for provider: antigravity",
    })).toBe(REQUEST_FAILURE_CLASSES.PROVIDER_AUTH_FAILURE);
  });

  it("keeps combo exhaustion for unavailable combo lanes", () => {
    expect(classifyRequestFailure({
      status: 406,
      message: "All combo models unavailable",
    })).toBe(REQUEST_FAILURE_CLASSES.COMBO_EXHAUSTED);
  });
});
