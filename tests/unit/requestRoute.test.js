import { describe, expect, it } from "vitest";

import {
  buildRequestRouteSummary,
  normalizeRequestRoute,
} from "../../src/shared/utils/requestRoute.js";

describe("request route utilities", () => {
  it("builds a readable combo route summary", () => {
    const route = normalizeRequestRoute({
      requestedModel: "claude-sonnet-4-6",
      comboName: "sonnet",
      tierName: "kilo-burst-coding",
      selectedModel: "kilocode/openrouter/hunter-alpha",
      resolvedProvider: "kilocode",
      resolvedModel: "openrouter/hunter-alpha",
      attemptedModels: ["kilocode/openrouter/hunter-alpha"],
    });

    expect(route.finalModel).toBe("kilocode/openrouter/hunter-alpha");
    expect(route.chain).toEqual([
      "claude-sonnet-4-6",
      "combo/sonnet",
      "kilocode/openrouter/hunter-alpha",
    ]);
    expect(buildRequestRouteSummary(route)).toBe(
      "claude-sonnet-4-6 -> combo/sonnet -> kilocode/openrouter/hunter-alpha | kilo-burst-coding",
    );
  });

  it("deduplicates repeated route steps", () => {
    const route = normalizeRequestRoute({
      requestedModel: "kilocode/openrouter/hunter-alpha",
      selectedModel: "kilocode/openrouter/hunter-alpha",
      finalModel: "kilocode/openrouter/hunter-alpha",
      attemptedModels: [
        "kilocode/openrouter/hunter-alpha",
        "kilocode/openrouter/hunter-alpha",
      ],
    });

    expect(route.chain).toEqual(["kilocode/openrouter/hunter-alpha"]);
    expect(route.attemptedModels).toEqual(["kilocode/openrouter/hunter-alpha"]);
  });

  it("preserves attempt metadata and terminal error classification", () => {
    const route = normalizeRequestRoute({
      requestedModel: "claude-sonnet-4-6",
      comboName: "sonnet",
      selectedModel: "codex/gpt-5.4",
      resolvedProvider: "codex",
      resolvedModel: "gpt-5.4",
      terminalErrorClass: "combo_exhausted",
      terminalErrorCode: "no_viable_provider",
      attempts: [
        {
          requestedModel: "kilocode/openrouter/hunter-alpha",
          provider: "kilocode",
          model: "openrouter/hunter-alpha",
          status: "failed",
          errorClass: "provider_auth_failure",
          statusCode: 401,
        },
      ],
    });

    expect(route.terminalErrorClass).toBe("combo_exhausted");
    expect(route.terminalErrorCode).toBe("no_viable_provider");
    expect(route.attempts).toEqual([
      expect.objectContaining({
        provider: "kilocode",
        model: "openrouter/hunter-alpha",
        status: "failed",
        errorClass: "provider_auth_failure",
        statusCode: 401,
      }),
    ]);
  });
});
