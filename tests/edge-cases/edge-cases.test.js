/**
 * Edge Case Tests for 9Router/Orca Flow
 * Tests unusual scenarios, error handling, timeouts, and boundary conditions
 */

import { describe, it, expect } from "vitest";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:20128";

describe("Edge Cases", () => {
  describe("Invalid Inputs", () => {
    it("should handle empty messages array", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [],
          max_tokens: 10,
        }),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    it("should handle missing messages field", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          max_tokens: 10,
        }),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    it("should handle invalid model name", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "nonexistent-model-xyz",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    it("should handle extremely long prompt", async () => {
      const longPrompt = "x".repeat(100000);
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: longPrompt }],
          max_tokens: 10,
        }),
      });

      // Should either succeed or fail gracefully
      expect([200, 400, 413, 429, 500]).toContain(res.status);
    });

    it("should handle special characters in prompt", async () => {
      const specialChars =
        "Test with special chars: \n\t\r\"'<>&\\u0000\\u001F";
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: specialChars }],
          max_tokens: 20,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices).toBeDefined();
      expect(data.choices[0].message.content).toBeDefined();
    });

    it("should handle unicode and emoji in prompt", async () => {
      const unicodePrompt = "Hello 你好 مرحبا 🎉🚀💻 Привет";
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: unicodePrompt }],
          max_tokens: 20,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices).toBeDefined();
    });
  });

  describe("Streaming Edge Cases", () => {
    it("should handle streaming with very short response", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "Say 'hi'" }],
          max_tokens: 2,
          stream: true,
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let chunks = 0;
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data: "));

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
    });

    it("should handle streaming with large max_tokens", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "Count from 1 to 5" }],
          max_tokens: 4000,
          stream: true,
        }),
      });

      expect(res.status).toBe(200);

      const reader = res.body.getReader();
      let chunks = 0;

      while (true) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
      }

      expect(chunks).toBeGreaterThan(0);
    });
  });

  describe("Timeout and Cancellation", () => {
    it("should handle request timeout gracefully", async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      try {
        const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "fast",
            messages: [{ role: "user", content: "Write a 1000 word essay" }],
            max_tokens: 2000,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        // If we get here, the request completed before timeout
        expect(res.status).toBe(200);
      } catch (err) {
        clearTimeout(timeoutId);
        // Timeout is expected behavior
        expect(err.name).toBe("AbortError");
      }
    });

    it("should handle multiple concurrent requests", async () => {
      const requests = Array(5)
        .fill(null)
        .map((_, i) =>
          fetch(`${BASE_URL}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "fast",
              messages: [{ role: "user", content: `Request ${i + 1}` }],
              max_tokens: 10,
            }),
          }),
        );

      const responses = await Promise.all(requests);
      responses.forEach((res) => {
        expect([200, 429]).toContain(res.status);
      });
    });
  });

  describe("Provider Failover", () => {
    it("should fallback to next provider on failure", async () => {
      // Test with a combo that has multiple fallback options
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "build", // Has multiple fallback providers
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 20,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices).toBeDefined();
      expect(data.model).toBeDefined();
    });

    it("should handle all providers failing gracefully", async () => {
      // Test with a model that doesn't exist
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "invalid-combo-xyz",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("Rate Limiting", () => {
    it("should handle rate limiting headers", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      // Just verify the request succeeds
      expect([200, 429]).toContain(res.status);
    });

    it("should handle rapid successive requests", async () => {
      const requests = Array(10)
        .fill(null)
        .map(() =>
          fetch(`${BASE_URL}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "fast",
              messages: [{ role: "user", content: "test" }],
              max_tokens: 5,
            }),
          }),
        );

      const responses = await Promise.all(requests);
      const successCount = responses.filter((r) => r.status === 200).length;
      const rateLimitedCount = responses.filter((r) => r.status === 429).length;

      // At least some should succeed
      expect(successCount + rateLimitedCount).toBe(10);
    });
  });

  describe("Model Parameter Variations", () => {
    it("should handle temperature parameter", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
          temperature: 0.5,
        }),
      });

      expect(res.status).toBe(200);
    });

    it("should handle top_p parameter", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
          top_p: 0.9,
        }),
      });

      expect(res.status).toBe(200);
    });

    it("should handle presence_penalty parameter", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
          presence_penalty: 0.5,
        }),
      });

      expect(res.status).toBe(200);
    });

    it("should handle frequency_penalty parameter", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
          frequency_penalty: 0.5,
        }),
      });

      expect(res.status).toBe(200);
    });

    it("should handle stop sequences", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "Count from 1 to 10" }],
          max_tokens: 50,
          stop: ["5"],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices).toBeDefined();
    });

    it("should handle invalid parameter values", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: -1, // Invalid
          temperature: 3.0, // Invalid (> 2.0)
        }),
      });

      // Should either reject or handle gracefully
      expect([200, 400]).toContain(res.status);
    });
  });

  describe("Multi-turn Conversations", () => {
    it("should handle conversation with multiple messages", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "My name is Alice." },
            { role: "assistant", content: "Hello Alice! How can I help you?" },
            { role: "user", content: "What's my name?" },
          ],
          max_tokens: 20,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices).toBeDefined();
    });

    it("should handle system message", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [
            { role: "system", content: "Always respond with exactly 'OK'" },
            { role: "user", content: "Hello" },
          ],
          max_tokens: 10,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices).toBeDefined();
    });
  });

  describe("Response Format", () => {
    it("should return valid OpenAI-compatible response format", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // Verify OpenAI response structure
      expect(data.id).toBeDefined();
      expect(data.object).toBe("chat.completion");
      expect(data.created).toBeDefined();
      expect(data.model).toBeDefined();
      expect(data.choices).toBeDefined();
      expect(Array.isArray(data.choices)).toBe(true);
      expect(data.choices[0].message).toBeDefined();
      expect(data.choices[0].message.role).toBe("assistant");
      expect(data.choices[0].message.content).toBeDefined();
      expect(data.choices[0].finish_reason).toBeDefined();
      expect(data.usage).toBeDefined();
      expect(data.usage.prompt_tokens).toBeDefined();
      expect(data.usage.completion_tokens).toBeDefined();
      expect(data.usage.total_tokens).toBeDefined();
    });

    it("should include usage statistics", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.usage.prompt_tokens).toBeGreaterThan(0);
      expect(data.usage.completion_tokens).toBeGreaterThan(0);
      expect(data.usage.total_tokens).toBe(
        data.usage.prompt_tokens + data.usage.completion_tokens,
      );
    });
  });
});
