import fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
  calculateCostFromTokens,
  getPricingForModel,
} from "../../src/shared/constants/pricing.js";

const db = JSON.parse(
  fs.readFileSync(new URL("../../data/db.json", import.meta.url), "utf8"),
);

function getCombo(name) {
  return (db.combos || []).find((combo) => combo.name === name);
}

describe("DeepSeek route config", () => {
  it("defines the DeepSeek aliases", () => {
    expect(db.modelAliases["deepseek-code"]).toBe("combo/deepseek-code");
    expect(db.modelAliases["deepseek-think"]).toBe("combo/deepseek-think");
    expect(db.modelAliases["deepseek-chat"]).toBe("deepseek/deepseek-chat");
    expect(db.modelAliases["deepseek-reasoner"]).toBe("deepseek/deepseek-reasoner");
  });

  it("defines the OpenCode aliases without changing the existing DeepSeek aliases", () => {
    expect(db.modelAliases["opencode-code"]).toBe("combo/opencode-code");
    expect(db.modelAliases["opencode-think"]).toBe("combo/opencode-think");
    expect(db.modelAliases["deepseek-code"]).toBe("combo/deepseek-code");
    expect(db.modelAliases["deepseek-think"]).toBe("combo/deepseek-think");
    expect(db.modelAliases.gsd).toBe("combo/deepseek-swarm");
  });

  it("defines the deepseek-code combo with direct, mirrored, then paid fallback tiers", () => {
    const combo = getCombo("deepseek-code");
    expect(combo).toBeTruthy();
    expect(combo.tiers).toEqual([
      {
        name: "direct-deepseek-primary",
        models: ["deepseek/deepseek-chat"],
      },
      {
        name: "deepseek-family-backup",
        models: [
          "siliconflow/deepseek-ai/DeepSeek-V3.2",
          "openrouter/deepseek/deepseek-chat",
        ],
      },
      {
        name: "paid-continuity",
        models: ["paid-coding"],
      },
    ]);
  });

  it("defines the deepseek-think combo with reasoning-first ordering", () => {
    const combo = getCombo("deepseek-think");
    expect(combo).toBeTruthy();
    expect(combo.tiers).toEqual([
      {
        name: "direct-deepseek-primary",
        models: ["deepseek/deepseek-reasoner"],
      },
      {
        name: "deepseek-family-backup",
        models: [
          "siliconflow/deepseek-ai/DeepSeek-R1",
          "openrouter/deepseek/deepseek-r1",
        ],
      },
      {
        name: "paid-continuity",
        models: ["paid-coding"],
      },
    ]);
  });

  it("defines the opencode-think combo with SiliconFlow first, then DeepSeek continuity", () => {
    const combo = getCombo("opencode-think");
    expect(combo).toBeTruthy();
    expect(combo.tiers).toEqual([
      {
        name: "siliconflow-heavy-primary",
        models: ["siliconflow/Qwen/Qwen3-Coder-480B-A35B-Instruct"],
      },
      {
        name: "deepseek-thinking-continuity",
        models: ["deepseek-think"],
      },
      {
        name: "paid-continuity",
        models: ["paid-coding"],
      },
    ]);
  });

  it("defines the opencode-code combo with a 70/30 DeepSeek and SiliconFlow split", () => {
    const combo = getCombo("opencode-code");
    expect(combo).toBeTruthy();
    expect(combo.tiers).toEqual([
      {
        name: "weighted-primary",
        models: ["deepseek-code", "opencode-think"],
        trafficShare: {
          "deepseek-code": 7,
          "opencode-think": 3,
        },
      },
      {
        name: "paid-continuity",
        models: ["paid-coding"],
      },
    ]);
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
