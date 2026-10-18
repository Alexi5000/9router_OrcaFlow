import { describe, expect, it } from "vitest";

import { calculateCostFromTokens, getPricingForModel } from "../../src/shared/constants/pricing.js";

describe("DeepSeek pricing", () => {
  it("uses the direct DeepSeek pricing for direct provider requests", () => {
    const pricing = getPricingForModel("deepseek", "deepseek-chat");
    expect(pricing).toEqual({
      input: 0.28,
      output: 0.42,
      cached: 0.028,
      reasoning: 0.42,
      cache_creation: 0.28,
    });

    const cost = calculateCostFromTokens(
      {
        prompt_tokens: 1_000_000,
        cached_tokens: 250_000,
        completion_tokens: 500_000,
      },
      pricing,
    );

    expect(cost).toBeCloseTo(0.427, 6);
  });
});
