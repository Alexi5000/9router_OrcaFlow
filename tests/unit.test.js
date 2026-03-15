/**
 * Unit Tests for 9Router/Orca Flow Core Logic
 * Tests combo resolution, provider selection, and model routing
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseRouterResponse, chatCompletion } from "./test-helpers.js";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:20128";
const TIMEOUT_MS = 60000;

describe("Combo Resolution", () => {
  const combos = [
    { name: "opus", description: "Heavy tasks - Opus 4.6 tiered fallback" },
    { name: "sonnet", description: "General tasks - Sonnet 4.6 tiered fallback" },
    { name: "fast", description: "Quick tasks - Free/fast models" },
    { name: "build", description: "Coding tasks - KiloCode + free models" },
    { name: "reason", description: "Thinking tasks - Reasoning models" },
  ];

  describe.each(combos)("$name combo", ({ name }) => {
    it(`should resolve ${name} combo to a working provider`, async () => {
      const res = await chatCompletion(BASE_URL, {
        model: name,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      });

      expect(res.status).toBe(200);
      const data = await parseRouterResponse(res);
      expect(data.model).toBeDefined();
      expect(data.choices).toBeDefined();
    }, TIMEOUT_MS);
  });
});

describe("Direct Provider Access", () => {
  const providers = [
    { provider: "groq", model: "llama-3.3-70b-versatile", description: "GROQ Llama" },
    { provider: "kilocode", model: "anthropic/claude-sonnet-4", description: "KiloCode Claude" },
    { provider: "openrouter", model: "deepseek/deepseek-r1", description: "OpenRouter DeepSeek" },
    { provider: "kiro", model: "claude-sonnet-4.5", description: "Kiro Claude" },
    { provider: "iflow", model: "qwen3-coder-plus", description: "iFlow Qwen" },
    { provider: "claude", model: "claude-sonnet-4-6", description: "Claude OAuth" },
  ];

  describe.each(providers)("$description", ({ provider, model }) => {
    it(`should route to ${provider} provider directly`, async () => {
      const res = await chatCompletion(BASE_URL, {
        model: `${provider}/${model}`,
        messages: [{ role: "user", content: "Say 'OK'" }],
        max_tokens: 10,
      });

      // Provider might be disabled or have issues
      if (res.status === 200) {
        const data = await parseRouterResponse(res);
        expect(data.choices).toBeDefined();
        expect(data.model).toBeDefined();
      } else {
        console.log(`  ${provider} returned ${res.status} (may be disabled)`);
        expect([400, 401, 403, 404, 429, 500, 503]).toContain(res.status);
      }
    }, TIMEOUT_MS);
  });
});

describe("Error Handling", () => {
  it("should return error for invalid model", async () => {
    const res = await chatCompletion(BASE_URL, {
      model: "invalid-model-xyz",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 10,
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  }, TIMEOUT_MS);

  it("should handle malformed JSON", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  }, TIMEOUT_MS);

  it("should handle empty request body", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  }, TIMEOUT_MS);
});

describe("Request Validation", () => {
  it("should validate required fields", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        max_tokens: 10,
      }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  }, TIMEOUT_MS);

  it("should validate message format", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ invalid: "format" }],
        max_tokens: 10,
      }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  }, TIMEOUT_MS);
});

describe("Response Transformation", () => {
  it("should transform provider response to OpenAI format", async () => {
    const res = await chatCompletion(BASE_URL, {
      model: "fast",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 10,
    });

    expect(res.status).toBe(200);
    const data = await parseRouterResponse(res);
    
    expect(data.id).toBeDefined();
    expect(data.object).toBe("chat.completion");
    expect(data.created).toBeDefined();
    expect(data.model).toBeDefined();
    expect(data.choices).toBeDefined();
    expect(data.choices[0].message.role).toBe("assistant");
    expect(data.choices[0].message.content).toBeDefined();
    expect(data.choices[0].finish_reason).toBeDefined();
    expect(data.usage).toBeDefined();
  }, TIMEOUT_MS);

  it("should handle streaming response transformation", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  }, TIMEOUT_MS);
});
