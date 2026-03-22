import { beforeEach, describe, expect, it, vi } from "vitest";

const saveUsageStats = vi.fn();
const buildRequestDetail = vi.fn(() => ({ id: "detail" }));
const extractRequestConfig = vi.fn(() => ({ stream: true }));
const saveRequestDetail = vi.fn(() => Promise.resolve());

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  saveUsageStats,
  buildRequestDetail,
  extractRequestConfig,
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail,
}));

describe("buildOnStreamComplete", () => {
  beforeEach(() => {
    saveUsageStats.mockClear();
    buildRequestDetail.mockClear();
    extractRequestConfig.mockClear();
    saveRequestDetail.mockClear();
  });

  it("persists streaming usage stats to dashboard history", async () => {
    const { buildOnStreamComplete } =
      await import("../../open-sse/handlers/chatCore/streamingHandler.js");

    const { onStreamComplete } = buildOnStreamComplete({
      provider: "kilocode",
      model: "openrouter/hunter-alpha",
      connectionId: "abc12345-0000-0000-0000-000000000000",
      apiKey: "sk-test",
      requestStartTime: Date.now() - 1000,
      body: { model: "claude-sonnet-4-6", stream: true },
      stream: true,
      finalBody: null,
      translatedBody: { model: "openrouter/hunter-alpha" },
      clientRawRequest: {
        endpoint: "/v1/messages",
        routing: {
          requestedModel: "claude-sonnet-4-6",
          comboName: "kilo-burst-coding",
          finalModel: "kilocode/openrouter/hunter-alpha",
        },
      },
    });

    onStreamComplete(
      { content: "done", thinking: null },
      { prompt_tokens: 123, completion_tokens: 45 },
      Date.now() - 500,
    );

    expect(saveUsageStats).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "kilocode",
        model: "openrouter/hunter-alpha",
        endpoint: "/v1/messages",
        persist: true,
        route: expect.objectContaining({
          requestedModel: "claude-sonnet-4-6",
          comboName: "kilo-burst-coding",
        }),
      }),
    );
  });
});
