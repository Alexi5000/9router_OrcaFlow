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

  it("redirects explicit provider requests when the alias target is a combo", async () => {
    const result = await getModelInfoCore("claude/claude-sonnet-4-6", {
      "claude-sonnet-4-6": "combo/sonnet",
    });

    expect(result).toEqual({
      provider: null,
      model: "sonnet",
    });
  });
});
