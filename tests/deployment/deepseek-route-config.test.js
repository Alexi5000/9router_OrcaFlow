import fs from "node:fs";

import { describe, expect, it } from "vitest";

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

});
