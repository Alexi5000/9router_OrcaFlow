import { describe, expect, it } from "vitest";

import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("DeepSeek executor request sanitization", () => {
  it("drops invalid max token fields before sending direct DeepSeek requests", () => {
    const executor = new DefaultExecutor("deepseek");
    const transformed = executor.transformRequest("deepseek-chat", {
      model: "deepseek-chat",
      stream: true,
      max_tokens: 0,
      max_completion_tokens: null,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(transformed.max_tokens).toBeUndefined();
    expect(transformed.max_completion_tokens).toBeUndefined();
    expect(transformed.messages).toHaveLength(1);
  });

  it("preserves valid max token fields for direct DeepSeek requests", () => {
    const executor = new DefaultExecutor("deepseek");
    const transformed = executor.transformRequest("deepseek-chat", {
      model: "deepseek-chat",
      max_tokens: 256,
      max_completion_tokens: 512,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(transformed.max_tokens).toBe(256);
    expect(transformed.max_completion_tokens).toBe(512);
  });

  it("clamps oversized token fields for direct DeepSeek chat requests", () => {
    const executor = new DefaultExecutor("deepseek");
    const transformed = executor.transformRequest("deepseek-chat", {
      model: "deepseek-chat",
      max_tokens: 999999,
      max_completion_tokens: 50000,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(transformed.max_tokens).toBe(8192);
    expect(transformed.max_completion_tokens).toBe(8192);
  });

  it("clamps oversized token fields for direct DeepSeek reasoner requests", () => {
    const executor = new DefaultExecutor("deepseek");
    const transformed = executor.transformRequest("deepseek-reasoner", {
      model: "deepseek-reasoner",
      max_tokens: 999999,
      max_completion_tokens: 999999,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(transformed.max_tokens).toBe(64000);
    expect(transformed.max_completion_tokens).toBe(64000);
  });
});
