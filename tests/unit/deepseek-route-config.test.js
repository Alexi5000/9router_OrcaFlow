import { describe, expect, it } from "vitest";

import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";
import {
  calculateCostFromTokens,
  getPricingForModel,
} from "../../src/shared/constants/pricing.js";

describe("DeepSeek route config", () => {
  it("surfaces the tracked DeepSeek CLI aliases in the expected order", () => {
    expect(
      CLI_TOOLS.deepseek.defaultModels.map((model) => model.alias),
    ).toEqual([
      "gsd",
      "deepseek-swarm",
      "deepseek-code",
      "deepseek-think",
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
  });

  it("keeps the direct DeepSeek aliases available for chat and reasoner", () => {
    const directAliases = CLI_TOOLS.deepseek.defaultModels
      .filter((model) =>
        ["deepseek-chat", "deepseek-reasoner"].includes(model.alias),
      )
      .map((model) => model.alias);

    expect(directAliases).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

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
