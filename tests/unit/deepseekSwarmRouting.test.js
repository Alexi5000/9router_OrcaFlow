import { describe, expect, it } from "vitest";

import {
  classifyDeepseekSwarmIntent,
  shapeDeepseekSwarmCombo,
} from "../../src/shared/utils/deepseekSwarmRouting.js";

const baseCombo = {
  name: "deepseek-swarm",
  routingStrategy: "deepseek-swarm",
  tiers: [
    {
      name: "coding-family",
      models: [
        "deepseek/deepseek-chat",
        "siliconflow/deepseek-ai/DeepSeek-V3.2",
      ],
    },
    {
      name: "thinking-family",
      models: [
        "deepseek/deepseek-reasoner",
        "siliconflow/deepseek-ai/DeepSeek-R1",
      ],
    },
    {
      name: "paid-continuity",
      models: [
        "paid-coding",
      ],
    },
  ],
};

describe("deepseek swarm routing", () => {
  it("prefers planning for orchestration-heavy prompts", () => {
    const intent = classifyDeepseekSwarmIntent({
      tools: [{ type: "function" }],
      messages: [
        {
          role: "user",
          content: "Plan a swarm orchestration with 6 agents, 3 verification checks, and a final rollout strategy.",
        },
      ],
    });

    expect(intent).toBe("planning");
  });

  it("prefers implementation for coding-heavy prompts", () => {
    const intent = classifyDeepseekSwarmIntent({
      messages: [
        {
          role: "user",
          content: "Write and refactor a TypeScript function, add tests, and patch the bug in the module.",
        },
      ],
    });

    expect(intent).toBe("implementation");
  });

  it("reorders deepseek-swarm combo for planning prompts", () => {
    const shaped = shapeDeepseekSwarmCombo(baseCombo, {
      tools: [{ type: "function" }],
      messages: [
        {
          role: "user",
          content: "Coordinate a multi-agent swarm plan and verification strategy.",
        },
      ],
    });

    expect(shaped.requestPreference).toBe("planning");
    expect(shaped.tiers.map((tier) => tier.name)).toEqual([
      "thinking-family",
      "coding-family",
      "paid-continuity",
    ]);
    expect(shaped.models).toEqual([
      "deepseek/deepseek-reasoner",
      "siliconflow/deepseek-ai/DeepSeek-R1",
      "deepseek/deepseek-chat",
      "siliconflow/deepseek-ai/DeepSeek-V3.2",
      "paid-coding",
    ]);
  });

  it("reorders deepseek-swarm combo for implementation prompts", () => {
    const shaped = shapeDeepseekSwarmCombo(baseCombo, {
      messages: [
        {
          role: "user",
          content: "Implement the debounce function, patch the tests, and ship the code fix.",
        },
      ],
    });

    expect(shaped.requestPreference).toBe("implementation");
    expect(shaped.tiers.map((tier) => tier.name)).toEqual([
      "coding-family",
      "thinking-family",
      "paid-continuity",
    ]);
    expect(shaped.models).toEqual([
      "deepseek/deepseek-chat",
      "siliconflow/deepseek-ai/DeepSeek-V3.2",
      "deepseek/deepseek-reasoner",
      "siliconflow/deepseek-ai/DeepSeek-R1",
      "paid-coding",
    ]);
  });
});
