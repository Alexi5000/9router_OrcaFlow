#!/usr/bin/env node
/**
 * Comprehensive Test Runner for 9Router/Orca Flow
 * Runs edge cases, unit tests, and e2e tests
 */

const BASE_URL = process.argv[2] || "http://localhost:20128";
const TIMEOUT_MS = 60000;

// Colors for output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

// Helper to parse JSON response
async function parseResponse(response) {
  const text = await response.text();
  if (text.includes("data: [DONE]")) {
    const jsonStr = text.split("\n")[0];
    return JSON.parse(jsonStr);
  }
  return JSON.parse(text);
}

// Helper to make chat completion request
async function chatCompletion(options) {
  const body = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.max_tokens || 20,
    stream: options.stream || false,
    ...options.extra,
  };

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return res;
}

// Test runner
class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.results = [];
  }

  async test(name, fn, timeout = TIMEOUT_MS) {
    const start = Date.now();
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Timeout")), timeout)
        ),
      ]);
      const latency = Date.now() - start;
      this.passed++;
      this.results.push({ name, status: "PASS", latency });
      log(colors.green, `  PASS ${name} (${latency}ms)`);
      return true;
    } catch (error) {
      const latency = Date.now() - start;
      this.failed++;
      this.results.push({ name, status: "FAIL", latency, error: error.message });
      log(colors.red, `  FAIL ${name} (${latency}ms)`);
      log(colors.dim, `        ${error.message}`);
      return false;
    }
  }

  skip(name) {
    this.skipped++;
    this.results.push({ name, status: "SKIP" });
    log(colors.yellow, `  SKIP ${name}`);
  }

  section(title) {
    console.log("\n" + "=".repeat(60));
    log(colors.cyan, `  ${title}`);
    console.log("=".repeat(60));
  }

  summary() {
    console.log("\n" + "=".repeat(60));
    log(colors.cyan, "  TEST SUMMARY");
    console.log("=".repeat(60));
    log(colors.green, `  Passed:  ${this.passed}`);
    log(colors.red, `  Failed:  ${this.failed}`);
    log(colors.yellow, `  Skipped: ${this.skipped}`);
    console.log("=".repeat(60));
    
    const total = this.passed + this.failed;
    const successRate = total > 0 ? ((this.passed / total) * 100).toFixed(1) : 0;
    console.log(`\n  Success Rate: ${successRate}%`);
    
    return this.failed === 0;
  }
}

// Test suites
async function runEdgeCaseTests(runner) {
  runner.section("Edge Case Tests");

  await runner.test("should handle empty messages array", async () => {
    const res = await chatCompletion({
      model: "fast",
      messages: [],
      max_tokens: 10,
    });
    if (res.status < 400) throw new Error(`Expected 4xx, got ${res.status}`);
  });

  await runner.test("should handle missing messages field", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "fast", max_tokens: 10 }),
    });
    if (res.status < 400) throw new Error(`Expected 4xx, got ${res.status}`);
  });

  await runner.test("should handle invalid model name", async () => {
    const res = await chatCompletion({
      model: "nonexistent-model-xyz",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 10,
    });
    if (res.status < 400) throw new Error(`Expected 4xx, got ${res.status}`);
  });

  await runner.test("should handle special characters in prompt", async () => {
    const res = await chatCompletion({
      model: "fast",
      messages: [{ role: "user", content: "Test with special chars: \n\t\r\"'<>&" }],
      max_tokens: 20,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await parseResponse(res);
    if (!data.choices) throw new Error("No choices in response");
  });

  await runner.test("should handle unicode and emoji in prompt", async () => {
    const res = await chatCompletion({
      model: "fast",
      messages: [{ role: "user", content: "Hello 你好 مرحبا 🎉🚀💻 Привет" }],
      max_tokens: 20,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await parseResponse(res);
    if (!data.choices) throw new Error("No choices in response");
  });

  await runner.test("should handle streaming with short response", async () => {
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
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let chunks = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      if (chunk.includes("data: ")) chunks++;
    }

    if (chunks === 0) throw new Error("No streaming chunks received");
  });

  await runner.test("should handle multiple concurrent requests", async () => {
    const requests = Array(5).fill(null).map((_, i) =>
      chatCompletion({
        model: "fast",
        messages: [{ role: "user", content: `Request ${i + 1}` }],
        max_tokens: 10,
      })
    );

    const responses = await Promise.all(requests);
    const successCount = responses.filter(r => r.status === 200).length;
    if (successCount === 0) throw new Error("All concurrent requests failed");
  });

  await runner.test("should handle temperature parameter", async () => {
    const res = await chatCompletion({
      model: "fast",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 10,
      extra: { temperature: 0.5 },
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await runner.test("should handle stop sequences", async () => {
    const res = await chatCompletion({
      model: "fast",
      messages: [{ role: "user", content: "Count from 1 to 10" }],
      max_tokens: 50,
      extra: { stop: ["5"] },
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await runner.test("should handle multi-turn conversation", async () => {
    const res = await chatCompletion({
      model: "fast",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "My name is Alice." },
        { role: "assistant", content: "Hello Alice!" },
        { role: "user", content: "What's my name?" },
      ],
      max_tokens: 30,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await parseResponse(res);
    if (!data.choices) throw new Error("No choices in response");
  });
}

async function runUnitTests(runner) {
  runner.section("Unit Tests - Combo Resolution");

  const combos = ["opus", "sonnet", "fast", "build", "reason"];

  for (const combo of combos) {
    await runner.test(`should resolve ${combo} combo`, async () => {
      const res = await chatCompletion({
        model: combo,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await parseResponse(res);
      if (!data.model) throw new Error("No model in response");
    });
  }

  runner.section("Unit Tests - Direct Provider Access");

  const providers = [
    { provider: "groq", model: "llama-3.3-70b-versatile" },
    { provider: "kilocode", model: "anthropic/claude-sonnet-4" },
    { provider: "openrouter", model: "deepseek/deepseek-r1" },
    { provider: "kiro", model: "claude-sonnet-4.5" },
    { provider: "iflow", model: "qwen3-coder-plus" },
    { provider: "claude", model: "claude-sonnet-4-6" },
  ];

  for (const { provider, model } of providers) {
    await runner.test(`should route to ${provider} provider`, async () => {
      const res = await chatCompletion({
        model: `${provider}/${model}`,
        messages: [{ role: "user", content: "Say 'OK'" }],
        max_tokens: 10,
      });
      // Provider might be disabled or have issues
      if (res.status === 200) {
        const text = await res.text();
        // Handle streaming response format
        const jsonStr = text.split("\n")[0];
        const data = JSON.parse(jsonStr);
        
        // Check for provider-specific error responses
        if (data.status && data.status !== "200" && data.msg) {
          throw new Error(`${provider} API error: ${data.msg}`);
        }
        
        if (!data.choices) throw new Error("No choices in response");
      } else if (provider === "iflow" && res.status === 406) {
        // iFlow API known issue - model not supported (external provider issue)
        throw new Error("iFlow API: Model not supported (external provider issue)");
      } else if (![400, 401, 403, 404, 429, 500, 503].includes(res.status)) {
        throw new Error(`Unexpected status: ${res.status}`);
      }
    });
  }

  runner.section("Unit Tests - Error Handling");

  await runner.test("should return error for invalid model", async () => {
    const res = await chatCompletion({
      model: "invalid-model-xyz",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 10,
    });
    if (res.status < 400) throw new Error(`Expected 4xx, got ${res.status}`);
  });

  await runner.test("should handle malformed JSON", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });
    if (res.status < 400) throw new Error(`Expected 4xx, got ${res.status}`);
  });

  await runner.test("should validate message format", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ invalid: "format" }],
        max_tokens: 10,
      }),
    });
    if (res.status < 400) throw new Error(`Expected 4xx, got ${res.status}`);
  });
}

async function runE2ETests(runner) {
  runner.section("E2E Tests - Performance");

  await runner.test("should respond within reasonable time", async () => {
    const start = Date.now();
    const res = await chatCompletion({
      model: "fast",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 10,
    });
    const latency = Date.now() - start;
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (latency > 10000) throw new Error(`Too slow: ${latency}ms`);
    console.log(`    Latency: ${latency}ms`);
  });

  await runner.test("should handle concurrent requests", async () => {
    const requests = Array(3).fill(null).map((_, i) =>
      chatCompletion({
        model: "fast",
        messages: [{ role: "user", content: `Request ${i + 1}` }],
        max_tokens: 10,
      })
    );

    const start = Date.now();
    const responses = await Promise.all(requests);
    const totalTime = Date.now() - start;

    const successCount = responses.filter(r => r.status === 200).length;
    if (successCount === 0) throw new Error("All requests failed");
    console.log(`    ${successCount}/3 succeeded in ${totalTime}ms`);
  });

  await runner.test("should measure all combo latencies", async () => {
    const combos = ["opus", "sonnet", "fast", "build", "reason"];
    const results = [];

    for (const combo of combos) {
      const start = Date.now();
      const res = await chatCompletion({
        model: combo,
        messages: [{ role: "user", content: "Say 'OK'" }],
        max_tokens: 5,
      });
      const latency = Date.now() - start;
      const data = res.ok ? await parseResponse(res) : null;
      results.push({ combo, status: res.status, latency, model: data?.model || "N/A" });
    }

    console.log("\n    Combo Latencies:");
    results.forEach(r => {
      const status = r.status === 200 ? "OK" : "FAIL";
      console.log(`      ${status} ${r.combo.padEnd(8)} -> ${r.model.padEnd(30)} (${r.latency}ms)`);
    });

    const successCount = results.filter(r => r.status === 200).length;
    if (successCount === 0) throw new Error("All combos failed");
  }, 120000);

  runner.section("E2E Tests - Response Format");

  await runner.test("should return valid OpenAI-compatible response", async () => {
    const res = await chatCompletion({
      model: "fast",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 10,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    
    const data = await parseResponse(res);
    
    if (!data.id) throw new Error("Missing id");
    if (data.object !== "chat.completion") throw new Error("Wrong object type");
    if (!data.created) throw new Error("Missing created");
    if (!data.model) throw new Error("Missing model");
    if (!data.choices || !Array.isArray(data.choices)) throw new Error("Missing choices");
    if (!data.choices[0].message) throw new Error("Missing message");
    if (data.choices[0].message.role !== "assistant") throw new Error("Wrong role");
    if (!data.choices[0].message.content) throw new Error("Missing content");
    if (!data.usage) throw new Error("Missing usage");
  });

  await runner.test("should include usage statistics", async () => {
    const res = await chatCompletion({
      model: "fast",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 10,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    
    const data = await parseResponse(res);
    
    if (!data.usage.prompt_tokens) throw new Error("Missing prompt_tokens");
    if (!data.usage.completion_tokens) throw new Error("Missing completion_tokens");
    if (!data.usage.total_tokens) throw new Error("Missing total_tokens");
    if (data.usage.total_tokens !== data.usage.prompt_tokens + data.usage.completion_tokens) {
      throw new Error("Token count mismatch");
    }
  });

  runner.section("E2E Tests - Health Check");

  await runner.test("should have API endpoint available", async () => {
    const res = await fetch(`${BASE_URL}/v1/models`);
    if (![200, 401, 404].includes(res.status)) {
      throw new Error(`Unexpected status: ${res.status}`);
    }
  });

  runner.section("E2E Tests - Error Recovery");

  await runner.test("should recover from invalid request", async () => {
    // Send invalid request
    await chatCompletion({
      model: "invalid-model",
      messages: [],
      max_tokens: 10,
    });

    // Follow up with valid request
    const res = await chatCompletion({
      model: "fast",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 10,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });
}

// Main
async function main() {
  console.log("\n" + "=".repeat(60));
  log(colors.cyan, "  9Router/Orca Flow Test Suite");
  console.log("=".repeat(60));
  console.log(`  Base URL: ${BASE_URL}`);
  console.log("=".repeat(60));

  const runner = new TestRunner();

  try {
    await runEdgeCaseTests(runner);
    await runUnitTests(runner);
    await runE2ETests(runner);
  } catch (error) {
    log(colors.red, `\nFatal error: ${error.message}`);
    console.error(error);
  }

  const success = runner.summary();
  process.exit(success ? 0 : 1);
}

main();
