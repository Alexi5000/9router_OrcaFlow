import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

function makeErrorResponse(status, message, retryAfter = null) {
  return new Response(
    JSON.stringify({
      error: {
        message,
      },
      ...(retryAfter ? { retryAfter } : {}),
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

describe("tiered combo routing", () => {
  beforeEach(() => {
    Object.keys(globalThis._comboRoutingState || {}).forEach((key) => {
      delete globalThis._comboRoutingState[key];
    });
  });

  it("exhausts earlier tiers before falling into a weighted paid tier", async () => {
    const combo = {
      name: "coding",
      tiers: [
        {
          name: "kilo-hourly",
          models: [
            "kilocode/openrouter/hunter-alpha",
            "kilocode/openrouter/healer-alpha",
          ],
        },
        {
          name: "paid-fallback",
          models: [
            "codex/gpt-5.4",
            "claude/claude-sonnet-4-6",
          ],
          trafficShare: {
            "codex/gpt-5.4": 2,
            "claude/claude-sonnet-4-6": 1,
          },
        },
      ],
    };

    const attempts = [];
    const handleSingleModel = vi.fn(async (_body, model) => {
      attempts.push(model);

      if (model.startsWith("kilocode/")) {
        return makeErrorResponse(429, "Kilo free model limit hit");
      }

      return new Response(JSON.stringify({ model }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    for (let i = 0; i < 3; i++) {
      const response = await handleComboChat({
        body: { messages: [{ role: "user", content: "Ship it." }] },
        models: combo.tiers.flatMap((tier) => tier.models),
        combo,
        handleSingleModel,
        log: {
          info: vi.fn(),
          warn: vi.fn(),
        },
      });

      expect(response.status).toBe(200);
    }

    expect(attempts).toEqual([
      "kilocode/openrouter/hunter-alpha",
      "kilocode/openrouter/healer-alpha",
      "codex/gpt-5.4",
      "kilocode/openrouter/hunter-alpha",
      "kilocode/openrouter/healer-alpha",
      "codex/gpt-5.4",
      "kilocode/openrouter/hunter-alpha",
      "kilocode/openrouter/healer-alpha",
      "claude/claude-sonnet-4-6",
    ]);
  });
});
