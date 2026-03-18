import { beforeEach, describe, expect, it, vi } from "vitest";

const appendRequestLog = vi.fn(() => Promise.resolve());
const saveRequestDetail = vi.fn(() => Promise.resolve());
const saveRequestUsage = vi.fn(() => Promise.resolve());

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog,
  saveRequestDetail,
  saveRequestUsage,
}));

describe("saveUsageStats", () => {
  beforeEach(() => {
    appendRequestLog.mockClear();
    saveRequestDetail.mockClear();
    saveRequestUsage.mockClear();
  });

  it("persists usage when explicitly requested", async () => {
    const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
    const route = {
      requestedModel: "claude-sonnet-4-6",
      comboName: "sonnet",
      tierName: "kilo-burst-coding",
      selectedModel: "kilocode/openrouter/hunter-alpha",
      attemptedModels: ["kilocode/openrouter/hunter-alpha"],
    };

    saveUsageStats({
      provider: "kilocode",
      model: "openrouter/hunter-alpha",
      tokens: { prompt_tokens: 123, completion_tokens: 45, reasoning_tokens: 9 },
      connectionId: "abc12345-0000-0000-0000-000000000000",
      apiKey: "sk-test-key",
      endpoint: "/v1/chat/completions",
      route,
      persist: true,
    });

    expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "kilocode",
      model: "openrouter/hunter-alpha",
      connectionId: "abc12345-0000-0000-0000-000000000000",
      tokens: expect.objectContaining({
        prompt_tokens: 123,
        completion_tokens: 45,
        reasoning_tokens: 9,
      }),
      endpoint: "/v1/chat/completions",
      route: expect.objectContaining({
        requestedModel: "claude-sonnet-4-6",
        comboName: "sonnet",
        finalModel: "kilocode/openrouter/hunter-alpha",
        summary: expect.stringContaining("claude-sonnet-4-6"),
      }),
    }));
    expect(appendRequestLog).toHaveBeenCalledWith(expect.objectContaining({
      provider: "kilocode",
      model: "openrouter/hunter-alpha",
      status: "200 OK",
    }));
  });

  it("does not persist usage by default", async () => {
    const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");

    saveUsageStats({
      provider: "codex",
      model: "gpt-5.4",
      tokens: { prompt_tokens: 111, completion_tokens: 22 },
      connectionId: "abc12345-0000-0000-0000-000000000000",
    });

    expect(saveRequestUsage).not.toHaveBeenCalled();
    expect(appendRequestLog).not.toHaveBeenCalled();
  });
});
