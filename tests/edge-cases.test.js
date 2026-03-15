/**
 * Edge Case Tests for 9Router/Orca Flow
 * Tests unusual scenarios, error handling, timeouts, and boundary conditions
 */

import { describe, it, expect } from "vitest";
import { parseRouterResponse, chatCompletion } from "./test-helpers.js";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:20128";
const TIMEOUT_MS = 60000;

describe("Edge Cases", () => {
  describe("Invalid Inputs", () => {
    it("should handle empty messages array", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [],
        max_tokens: 10,
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
    }, TIMEOUT_MS);

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
    }, TIMEOUT_MS);

    it("should handle invalid model name", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "nonexistent-model-xyz",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
    }, TIMEOUT_MS);

    it("should handle special characters in prompt", async () => {
      const specialChars = "Test with special chars: \n\t\r\"'<>&";
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [{ role: "user", content: specialChars }],
        max_tokens: 20,
      });

      expect(res.status).toBe(200);
      const data = await parseRouterResponse(res);
      expect(data.choices).toBeDefined();
    }, TIMEOUT_MS);

    it("should handle unicode and emoji in prompt", async () => {
      const unicodePrompt = "Hello 你好 مرحبا 🎉🚀💻 Привет";
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [{ role: "user", content: unicodePrompt }],
        max_tokens: 20,
      });

      expect(res.status).toBe(200);
      const data = await parseRouterResponse(res);
      expect(data.choices).toBeDefined();
    }, TIMEOUT_MS);
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
  });

  describe("Timeout and Cancellation", () => {
    it("should handle multiple concurrent requests", async () => {
      const requests = Array(5).fill(null).map((_, i) => 
        chatCompletion(BASE_URL, {
          model: "fast",
          messages: [{ role: "user", content: `Request ${i + 1}` }],
          max_tokens: 10,
        })
      );

      const responses = await Promise.all(requests);
      const successCount = responses.filter(r => r.status === 200).length;
      expect(successCount).toBeGreaterThan(0);
    }, TIMEOUT_MS * 2);
  });

  describe("Provider Failover", () => {
    it("should fallback to next provider on failure", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "build", // Has multiple fallback providers
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 20,
      });

      expect(res.status).toBe(200);
      const data = await parseRouterResponse(res);
      expect(data.choices).toBeDefined();
      expect(data.model).toBeDefined();
    }, TIMEOUT_MS);

    it("should handle all providers failing gracefully", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "invalid-combo-xyz",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
    }, TIMEOUT_MS);
  });

  describe("Model Parameter Variations", () => {
    it("should handle temperature parameter", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
        temperature: 0.5,
      });

      expect(res.status).toBe(200);
    }, TIMEOUT_MS);

    it("should handle top_p parameter", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
        top_p: 0.9,
      });

      expect(res.status).toBe(200);
    }, TIMEOUT_MS);

    it("should handle presence_penalty parameter", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
        presence_penalty: 0.5,
      });

      expect(res.status).toBe(200);
    }, TIMEOUT_MS);

    it("should handle frequency_penalty parameter", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
        frequency_penalty: 0.5,
      });

      expect(res.status).toBe(200);
    }, TIMEOUT_MS);

    it("should handle stop sequences", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [{ role: "user", content: "Count from 1 to 10" }],
        max_tokens: 50,
        stop: ["5"],
      });

      expect(res.status).toBe(200);
      const data = await parseRouterResponse(res);
      expect(data.choices).toBeDefined();
    }, TIMEOUT_MS);
  });

  describe("Multi-turn Conversations", () => {
    it("should handle conversation with multiple messages", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "My name is Alice." },
          { role: "assistant", content: "Hello Alice! How can I help you?" },
          { role: "user", content: "What's my name?" },
        ],
        max_tokens: 30,
      });

      expect(res.status).toBe(200);
      const data = await parseRouterResponse(res);
      expect(data.choices).toBeDefined();
    }, TIMEOUT_MS);

    it("should handle system message", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [
          { role: "system", content: "Always respond with exactly 'OK'" },
          { role: "user", content: "Hello" },
        ],
        max_tokens: 10,
      });

      expect(res.status).toBe(200);
      const data = await parseRouterResponse(res);
      expect(data.choices).toBeDefined();
    }, TIMEOUT_MS);
  });

  describe("Response Format", () => {
    it("should return valid OpenAI-compatible response format", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      });

      expect(res.status).toBe(200);
      const data = await parseRouterResponse(res);

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
    }, TIMEOUT_MS);

    it("should include usage statistics", async () => {
      const res = await chatCompletion(BASE_URL, {
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      });

      expect(res.status).toBe(200);
      const data = await parseRouterResponse(res);
      
      expect(data.usage.prompt_tokens).toBeGreaterThan(0);
      expect(data.usage.completion_tokens).toBeGreaterThan(0);
      expect(data.usage.total_tokens).toBe(
        data.usage.prompt_tokens + data.usage.completion_tokens
      );
    }, TIMEOUT_MS);
  });
});
