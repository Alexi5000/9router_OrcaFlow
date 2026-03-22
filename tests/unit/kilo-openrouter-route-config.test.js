import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { getPricingForModel } from "../../src/shared/constants/pricing.js";

const db = JSON.parse(
  fs.readFileSync(new URL("../../data/db.json", import.meta.url), "utf8"),
);

function getCombo(name) {
  return (db.combos || []).find((combo) => combo.name === name);
}

describe("Kilo and OpenRouter coding rotation config", () => {
  it("defines the hybrid alias and keeps the pure kilo alias", () => {
    expect(db.modelAliases["kilo-burst-coding"]).toBe("combo/kilo-burst-coding");
    expect(db.modelAliases["kilo-openrouter-coding"]).toBe("combo/kilo-openrouter-coding");
  });

  it("makes kilo burst healer-first with hunter as the heavier secondary lane", () => {
    const combo = getCombo("kilo-burst-coding");
    expect(combo).toBeTruthy();
    expect(combo.trafficShare).toEqual({
      "kilocode/openrouter/healer-alpha": 2,
      "kilocode/openrouter/hunter-alpha": 1,
    });
  });

  it("defines the OpenRouter lane with MiniMax first and Hunter as the heavier secondary", () => {
    const combo = getCombo("openrouter-alpha-coding");
    expect(combo).toBeTruthy();
    expect(combo.tiers).toEqual([
      {
        name: "openrouter-primary",
        models: [
          "openrouter/minimax/minimax-m2.5",
          "openrouter/openrouter/hunter-alpha",
        ],
        trafficShare: {
          "openrouter/minimax/minimax-m2.5": 2,
          "openrouter/openrouter/hunter-alpha": 1,
        },
      },
      {
        name: "paid-continuity",
        models: ["paid-coding"],
      },
    ]);
  });

  it("defines the hybrid 70/30 kilo and OpenRouter rotation", () => {
    const combo = getCombo("kilo-openrouter-coding");
    expect(combo).toBeTruthy();
    expect(combo.tiers).toEqual([
      {
        name: "weighted-primary",
        models: [
          "kilo-burst-coding",
          "openrouter-alpha-coding",
        ],
        trafficShare: {
          "kilo-burst-coding": 7,
          "openrouter-alpha-coding": 3,
        },
      },
      {
        name: "paid-continuity",
        models: ["paid-coding"],
      },
    ]);
  });

  it("uses the supplied MiniMax and Hunter pricing on the OpenRouter lane", () => {
    expect(getPricingForModel("openrouter", "minimax/minimax-m2.5")).toEqual({
      input: 0.20,
      output: 1.20,
      cached: 0.20,
      reasoning: 1.20,
      cache_creation: 0.20,
    });

    expect(getPricingForModel("openrouter", "minimax/minimax-m2.5-20260211")).toEqual({
      input: 0.20,
      output: 1.20,
      cached: 0.20,
      reasoning: 1.20,
      cache_creation: 0.20,
    });

    expect(getPricingForModel("openrouter", "openrouter/hunter-alpha")).toEqual({
      input: 0.00,
      output: 0.00,
      cached: 0.00,
      reasoning: 0.00,
      cache_creation: 0.00,
    });
  });
});
