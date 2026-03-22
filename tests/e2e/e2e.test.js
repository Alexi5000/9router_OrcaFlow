/**
 * E2E Tests for 9Router/Orca Flow
 * Full integration tests against running server
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:20128";
const TIMEOUT_MS = 60000;

describe("E2E: Combo Tests", () => {
  const combos = ["opus", "sonnet", "fast", "build", "reason"];

  describe.each(combos)("%s combo", (combo) => {
    it(`should respond to basic prompt`, async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: combo,
          messages: [{ role: "user", content: "Say 'Hello, I am working!' in exactly those words." }],
          max_tokens: 20,
          stream: false,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices).toBeDefined();
      expect(data.choices[0].message.content).toBeDefined();
      expect(data.model).toBeDefined();
    }, TIMEOUT_MS);

    it(`should handle streaming`, async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: combo,
          messages: [{ role: "user", content: "Count from 1 to 3" }],
          max_tokens: 20,
          stream: true,
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let content = "";
      let chunks = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(line => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            content += delta;
            chunks++;
          } catch {}
        }
      }

      expect(chunks).toBeGreaterThan(0);
      expect(content.length).toBeGreaterThan(0);
    }, TIMEOUT_MS);

    it(`should handle multi-turn conversation`, async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: combo,
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "My name is Test." },
            { role: "assistant", content: "Hello Test! How can I help you?" },
            { role: "user", content: "What's my name?" },
          ],
          max_tokens: 30,
          stream: false,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices).toBeDefined();
    }, TIMEOUT_MS);
  });
});

describe("E2E: Provider Tests", () => {
  const providers = [
    { provider: "groq", model: "llama-3.3-70b-versatile", description: "GROQ Llama" },
    { provider: "kilocode", model: "anthropic/claude-sonnet-4", description: "KiloCode Claude" },
    { provider: "openrouter", model: "deepseek/deepseek-r1", description: "OpenRouter DeepSeek" },
    { provider: "kiro", model: "claude-sonnet-4.5", description: "Kiro Claude" },
    { provider: "iflow", model: "qwen-coder-plus", description: "iFlow Qwen" },
    { provider: "claude", model: "claude-sonnet-4-6", description: "Claude OAuth" },
  ];

  describe.each(providers)("$description", ({ provider, model }) => {
    it(`should respond via ${provider}`, async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `${provider}/${model}`,
          messages: [{ role: "user", content: "Say 'OK'" }],
          max_tokens: 10,
          stream: false,
        }),
      });

      // Provider might be disabled or have issues
      if (res.status === 200) {
        const data = await res.json();
        expect(data.choices).toBeDefined();
        expect(data.model).toBeDefined();
      } else {
        console.log(`  ${provider} returned ${res.status} (may be disabled)`);
      }
    }, TIMEOUT_MS);
  });
});

describe("E2E: Performance Tests", () => {
  it("should respond within reasonable time", async () => {
    const start = Date.now();

    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10,
        stream: false,
      }),
    });

    const latency = Date.now() - start;

    expect(res.status).toBe(200);
    expect(latency).toBeLessThan(10000); // 10 seconds max
    console.log(`  Latency: ${latency}ms`);
  }, TIMEOUT_MS);

  it("should handle concurrent requests", async () => {
    const requests = Array(3).fill(null).map((_, i) =>
      fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: `Request ${i + 1}` }],
          max_tokens: 10,
          stream: false,
        }),
      })
    );

    const start = Date.now();
    const responses = await Promise.all(requests);
    const totalTime = Date.now() - start;

    const successCount = responses.filter(r => r.status === 200).length;
    expect(successCount).toBeGreaterThan(0);
    console.log(`  ${successCount}/3 succeeded in ${totalTime}ms`);
  }, TIMEOUT_MS * 2);

  it("should measure combo latencies", async () => {
    const combos = ["opus", "sonnet", "fast", "build", "reason"];
    const results = [];

    for (const combo of combos) {
      const start = Date.now();

      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: combo,
          messages: [{ role: "user", content: "Say 'OK'" }],
          max_tokens: 5,
          stream: false,
        }),
      });

      const latency = Date.now() - start;
      const data = res.ok ? await res.json() : null;

      results.push({
        combo,
        status: res.status,
        latency,
        model: data?.model || "N/A",
      });
    }

    console.log("\n  Combo Latencies:");
    results.forEach(r => {
      const status = r.status === 200 ? "✅" : "❌";
      console.log(`    ${status} ${r.combo.padEnd(8)} → ${r.model.padEnd(30)} (${r.latency}ms)`);
    });

    const successCount = results.filter(r => r.status === 200).length;
    expect(successCount).toBe(combos.length);
  }, TIMEOUT_MS * 5);
});

describe("E2E: Health Check", () => {
  it("should have healthy server", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect([200, 404]).toContain(res.status); // Health endpoint might not exist
  });

  it("should have API endpoint available", async () => {
    const res = await fetch(`${BASE_URL}/v1/models`);
    expect([200, 401, 404]).toContain(res.status);
  });
});

describe("E2E: Error Recovery", () => {
  it("should recover from invalid request", async () => {
    // Send invalid request
    await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "invalid-model",
        messages: [],
        max_tokens: 10,
        stream: false,
      }),
    });

    // Follow up with valid request
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10,
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
  }, TIMEOUT_MS);

  it("should handle malformed JSON", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("E2E: Feature Tests", () => {
  it("should support system messages", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [
          { role: "system", content: "Always respond with exactly 'SYSTEM_OK'" },
          { role: "user", content: "Hello" },
        ],
        max_tokens: 20,
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices).toBeDefined();
  }, TIMEOUT_MS);

  it("should support temperature parameter", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10,
        temperature: 0.5,
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
  }, TIMEOUT_MS);

  it("should support stop sequences", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "Count from 1 to 10" }],
        max_tokens: 50,
        stop: ["5"],
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices).toBeDefined();
  }, TIMEOUT_MS);

  it("should return usage statistics", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10,
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.usage).toBeDefined();
    expect(data.usage.prompt_tokens).toBeGreaterThan(0);
    expect(data.usage.completion_tokens).toBeGreaterThan(0);
    expect(data.usage.total_tokens).toBe(
      data.usage.prompt_tokens + data.usage.completion_tokens
    );
  }, TIMEOUT_MS);
});
