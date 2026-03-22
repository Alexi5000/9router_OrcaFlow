import { describe, expect, it } from "vitest";

import { getModelInfoCore } from "../../open-sse/services/model.js";

describe("model alias resolution for prefixed client models", () => {
  it("routes Claude Code shorthand models through the alias map", async () => {
    const result = await getModelInfoCore("cc/claude-sonnet-4-6", {
      "claude-sonnet-4-6": "combo/sonnet",
    });

    expect(result).toEqual({
      provider: null,
      model: "sonnet",
    });
  });

  it("keeps direct full-provider requests direct", async () => {
    const result = await getModelInfoCore("claude/claude-sonnet-4-6", {
      "claude-sonnet-4-6": "github/gpt-4.1",
    });

    expect(result).toEqual({
      provider: "claude",
      model: "claude-sonnet-4-6",
    });
  });

  it("keeps explicit provider requests direct even when the bare model alias points to a combo", async () => {
    const result = await getModelInfoCore("claude/claude-sonnet-4-6", {
      "claude-sonnet-4-6": "combo/sonnet",
    });

    expect(result).toEqual({
      provider: "claude",
      model: "claude-sonnet-4-6",
    });
  });

  it("routes explicit Claude client requests through aliases when strict client routing is enabled", async () => {
    const result = await getModelInfoCore(
      "claude/claude-sonnet-4-6",
      {
        "claude-sonnet-4-6": "combo/sonnet",
      },
      { resolveClientPrefixedAliases: true },
    );

    expect(result).toEqual({
      provider: null,
      model: "sonnet",
    });
  });

  it("does not recurse combo hops back into the combo alias", async () => {
    const result = await getModelInfoCore("antigravity/claude-sonnet-4-6", {
      "claude-sonnet-4-6": "combo/sonnet",
    });

    expect(result).toEqual({
      provider: "antigravity",
      model: "claude-sonnet-4-6",
    });
  });
});
