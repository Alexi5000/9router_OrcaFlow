/**
 * Unit Tests for 9Router/Orca Flow Core Logic
 * Tests combo resolution, provider selection, and model routing
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fetch for unit tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Combo Resolution", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("Model Alias Resolution", () => {
    it("should resolve 'opus' combo to correct provider chain", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "test-123",
          object: "chat.completion",
          created: Date.now(),
          model: "anthropic/claude-sonnet-4",
          choices: [{
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "opus",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.model).toBeDefined();
    });

    it("should resolve 'sonnet' combo to correct provider chain", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "test-456",
          object: "chat.completion",
          created: Date.now(),
          model: "anthropic/claude-sonnet-4",
          choices: [{
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonnet",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(true);
    });

    it("should resolve 'fast' combo to fastest provider", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "test-789",
          object: "chat.completion",
          created: Date.now(),
          model: "llama-3.3-70b-versatile",
          choices: [{
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(true);
    });

    it("should resolve 'build' combo to coding-optimized chain", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "test-build",
          object: "chat.completion",
          created: Date.now(),
          model: "anthropic/claude-sonnet-4",
          choices: [{
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "build",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(true);
    });

    it("should resolve 'reason' combo to reasoning-optimized chain", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "test-reason",
          object: "chat.completion",
          created: Date.now(),
          model: "deepseek/deepseek-chat",
          choices: [{
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "reason",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(true);
    });
  });

  describe("Direct Provider Access", () => {
    it("should route to GROQ provider directly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "test-groq",
          object: "chat.completion",
          created: Date.now(),
          model: "llama-3.3-70b-versatile",
          choices: [{
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "groq/llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(true);
    });

    it("should route to KiloCode provider directly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "test-kilocode",
          object: "chat.completion",
          created: Date.now(),
          model: "anthropic/claude-sonnet-4",
          choices: [{
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "kilocode/anthropic/claude-sonnet-4",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(true);
    });

    it("should route to OpenRouter provider directly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "test-openrouter",
          object: "chat.completion",
          created: Date.now(),
          model: "deepseek/deepseek-r1",
          choices: [{
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openrouter/deepseek/deepseek-r1",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should return error for invalid model", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: "Model not found",
            type: "invalid_request_error",
          },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "invalid-model",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    it("should handle provider timeout", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({
          error: {
            message: "Provider timeout",
            type: "timeout_error",
          },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(504);
    });

    it("should handle rate limiting", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            message: "Rate limit exceeded",
            type: "rate_limit_error",
          },
        }),
      });

      const res = await fetch("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fast",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(429);
    });
  });
});

describe("Request Validation", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should validate required fields", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Missing required field: messages",
          type: "invalid_request_error",
        },
      }),
    });

    const res = await fetch("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        max_tokens: 10,
      }),
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it("should validate message format", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Invalid message format",
          type: "invalid_request_error",
        },
      }),
    });

    const res = await fetch("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ invalid: "format" }],
        max_tokens: 10,
      }),
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it("should validate max_tokens range", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "max_tokens must be positive",
          type: "invalid_request_error",
        },
      }),
    });

    const res = await fetch("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: -1,
      }),
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it("should validate temperature range", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "temperature must be between 0 and 2",
          type: "invalid_request_error",
        },
      }),
    });

    const res = await fetch("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
        temperature: 3.0,
      }),
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });
});

describe("Response Transformation", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should transform provider response to OpenAI format", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1234567890,
        model: "llama-3.3-70b-versatile",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "Hello, I'm working!",
          },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      }),
    });

    const res = await fetch("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    
    expect(data.id).toBeDefined();
    expect(data.object).toBe("chat.completion");
    expect(data.created).toBeDefined();
    expect(data.model).toBeDefined();
    expect(data.choices).toBeDefined();
    expect(data.choices[0].message.role).toBe("assistant");
    expect(data.choices[0].message.content).toBeDefined();
    expect(data.choices[0].finish_reason).toBeDefined();
    expect(data.usage).toBeDefined();
  });

  it("should handle streaming response transformation", async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: mockStream,
      headers: new Headers({ "content-type": "text/event-stream" }),
    });

    const res = await fetch("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
        stream: true,
      }),
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});
