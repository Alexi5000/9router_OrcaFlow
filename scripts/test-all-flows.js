#!/usr/bin/env node
/**
 * Comprehensive Chain/Combo Verification Script for 9Router/Orca Flow
 * Tests all combos, providers, and flows to ensure everything works
 * 
 * Usage: node scripts/test-all-flows.js [baseUrl]
 */

const BASE_URL = process.argv[2] || "http://localhost:20128";
const TIMEOUT_MS = 120000; // 2 minutes per test

// Color codes for output
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  dim: "\x1b[2m",
};

function log(color, ...args) {
  console.log(color, ...args, COLORS.reset);
}

function logSection(title) {
  console.log("\n" + "=".repeat(60));
  log(COLORS.bold + COLORS.cyan, `  ${title}`);
  console.log("=".repeat(60));
}

function logSubsection(title) {
  console.log("\n" + "-".repeat(40));
  log(COLORS.cyan, `  ${title}`);
  console.log("-".repeat(40));
}

// Test configurations
const COMBOS = [
  { name: "opus", description: "Heavy tasks - Opus 4.6 tiered fallback" },
  { name: "sonnet", description: "General tasks - Sonnet 4.6 tiered fallback" },
  { name: "fast", description: "Quick tasks - Free/fast models" },
  { name: "build", description: "Coding tasks - KiloCode + free models" },
  { name: "reason", description: "Thinking tasks - Reasoning models" },
];

const DIRECT_PROVIDERS = [
  { provider: "antigravity", model: "claude-sonnet-4-6", description: "Antigravity Claude Sonnet" },
  { provider: "antigravity", model: "gemini-3.1-pro-high", description: "Antigravity Gemini 3.1" },
  { provider: "github", model: "claude-opus-4.6", description: "GitHub Copilot Opus" },
  { provider: "github", model: "gpt-4.1", description: "GitHub Copilot GPT-4.1" },
  { provider: "kiro", model: "claude-sonnet-4.5", description: "Kiro Claude Sonnet" },
  { provider: "kiro", model: "claude-haiku-4.5", description: "Kiro Claude Haiku" },
  { provider: "kilocode", model: "anthropic/claude-sonnet-4-20250514", description: "KiloCode Claude Sonnet" },
  { provider: "groq", model: "llama-3.3-70b-versatile", description: "GROQ Llama 3.3" },
  { provider: "groq", model: "moonshotai/kimi-k2-instruct-0905", description: "GROQ Kimi K2" },
  { provider: "iflow", model: "qwen3-coder-plus", description: "iFlow Qwen3 Coder" },
  { provider: "openrouter", model: "deepseek/deepseek-r1:free", description: "OpenRouter DeepSeek R1 Free" },
  { provider: "claude", model: "claude-sonnet-4-6", description: "Claude OAuth (last resort)" },
];

const MODEL_ALIASES = [
  { alias: "opus", expected: "antigravity", description: "Opus alias" },
  { alias: "sonnet", expected: "antigravity", description: "Sonnet alias" },
  { alias: "fast", expected: "groq", description: "Fast alias" },
  { alias: "gpt-4o", expected: "github", description: "GPT-4o alias" },
  { alias: "gemini-3.1-pro", expected: "antigravity", description: "Gemini alias" },
];

const TEST_PROMPT = "Say 'Hello, I am working!' in exactly those words.";

// Helper functions
async function parseJsonResponse(response, testId, latency) {
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const actualModel = data.model || "";
  const tokens = data.usage;
  
  return {
    testId,
    success: true,
    status: response.status,
    latency,
    actualModel,
    content,
    tokens,
  };
}

async function parseStreamingResponse(response, testId, latency) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let chunks = 0;
  let content = "";
  let actualModel = "";

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
        if (!actualModel && parsed.model) actualModel = parsed.model;
        chunks++;
      } catch {}
    }
  }

  return {
    testId,
    success: true,
    status: response.status,
    latency,
    actualModel,
    content,
    chunks,
  };
}

// Test combo
async function testCombo(comboName, streaming = false) {
  const startTime = Date.now();
  const testId = `combo-${comboName}-${streaming ? 'stream' : 'sync'}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: comboName,
        messages: [{ role: "user", content: TEST_PROMPT }],
        max_tokens: 50,
        stream: streaming,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      return {
        testId,
        success: false,
        status: response.status,
        error: error.slice(0, 300),
        latency,
      };
    }

    if (streaming) {
      return await parseStreamingResponse(response, testId, latency);
    } else {
      return await parseJsonResponse(response, testId, latency);
    }
  } catch (error) {
    return {
      testId,
      success: false,
      error: error.name === "AbortError" ? "Timeout" : error.message,
      latency: Date.now() - startTime,
    };
  }
}

// Test direct provider/model
async function testDirectProvider(provider, model, streaming = false) {
  const startTime = Date.now();
  const testId = `direct-${provider}-${model}-${streaming ? 'stream' : 'sync'}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `${provider}/${model}`,
        messages: [{ role: "user", content: TEST_PROMPT }],
        max_tokens: 50,
        stream: streaming,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      return {
        testId,
        success: false,
        status: response.status,
        error: error.slice(0, 300),
        latency,
        provider,
        model,
      };
    }

    if (streaming) {
      const result = await parseStreamingResponse(response, testId, latency);
      return { ...result, provider, model };
    } else {
      const result = await parseJsonResponse(response, testId, latency);
      return { ...result, provider, model };
    }
  } catch (error) {
    return {
      testId,
      success: false,
      error: error.name === "AbortError" ? "Timeout" : error.message,
      latency: Date.now() - startTime,
      provider,
      model,
    };
  }
}

// Test model alias
async function testAlias(alias, expectedProvider) {
  const startTime = Date.now();
  const testId = `alias-${alias}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: alias,
        messages: [{ role: "user", content: TEST_PROMPT }],
        max_tokens: 50,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      return {
        testId,
        success: false,
        status: response.status,
        error: error.slice(0, 300),
        latency,
        alias,
        expectedProvider,
      };
    }

    const result = await parseJsonResponse(response, testId, latency);
    
    // Check if the actual provider matches expected
    const actualProvider = result.actualModel?.split("/")[0];
    const providerMatch = actualProvider === expectedProvider;
    
    return {
      ...result,
      alias,
      expectedProvider,
      actualProvider,
      providerMatch,
      success: result.success && providerMatch,
    };
  } catch (error) {
    return {
      testId,
      success: false,
      error: error.name === "AbortError" ? "Timeout" : error.message,
      latency: Date.now() - startTime,
      alias,
      expectedProvider,
    };
  }
}

// Main test runner
async function main() {
  logSection("9Router Comprehensive Flow Verification");
  log(COLORS.blue, `Base URL: ${BASE_URL}`);
  log(COLORS.blue, `Time: ${new Date().toISOString()}`);
  log(COLORS.blue, `Timeout: ${TIMEOUT_MS / 1000}s per test`);

  const allResults = [];
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  // ============================================
  // SECTION 1: Test Combos
  // ============================================
  logSection("Section 1: Combo Tests");

  for (const combo of COMBOS) {
    logSubsection(`Combo: ${combo.name} - ${combo.description}`);
    
    // Test non-streaming
    process.stdout.write(`  Non-streaming... `);
    const syncResult = await testCombo(combo.name, false);
    allResults.push(syncResult);
    totalTests++;
    
    if (syncResult.success) {
      passedTests++;
      log(COLORS.green, `✅ PASS (${syncResult.latency}ms)`);
      log(COLORS.dim, `     Model: ${syncResult.actualModel}`);
      log(COLORS.dim, `     Response: "${syncResult.content?.slice(0, 50)}..."`);
    } else {
      failedTests++;
      log(COLORS.red, `❌ FAIL (${syncResult.latency}ms)`);
      log(COLORS.red, `     Error: ${syncResult.error || syncResult.status}`);
    }

    // Test streaming
    process.stdout.write(`  Streaming... `);
    const streamResult = await testCombo(combo.name, true);
    allResults.push(streamResult);
    totalTests++;
    
    if (streamResult.success) {
      passedTests++;
      log(COLORS.green, `✅ PASS (${streamResult.latency}ms, ${streamResult.chunks} chunks)`);
    } else {
      failedTests++;
      log(COLORS.red, `❌ FAIL (${streamResult.latency}ms)`);
      log(COLORS.red, `     Error: ${streamResult.error || streamResult.status}`);
    }
  }

  // ============================================
  // SECTION 2: Test Direct Providers
  // ============================================
  logSection("Section 2: Direct Provider Tests");

  for (const test of DIRECT_PROVIDERS) {
    logSubsection(`${test.description}`);
    
    // Test non-streaming only for direct providers (to save time)
    process.stdout.write(`  Testing ${test.provider}/${test.model}... `);
    const result = await testDirectProvider(test.provider, test.model, false);
    allResults.push(result);
    totalTests++;
    
    if (result.success) {
      passedTests++;
      log(COLORS.green, `✅ PASS (${result.latency}ms)`);
      log(COLORS.dim, `     Model: ${result.actualModel}`);
    } else {
      failedTests++;
      log(COLORS.red, `❌ FAIL (${result.latency}ms)`);
      log(COLORS.red, `     Error: ${result.error || result.status}`);
    }
  }

  // ============================================
  // SECTION 3: Test Model Aliases
  // ============================================
  logSection("Section 3: Model Alias Tests");

  for (const alias of MODEL_ALIASES) {
    logSubsection(`${alias.description}: ${alias.alias} → ${alias.expected}`);
    
    process.stdout.write(`  Testing alias "${alias.alias}"... `);
    const result = await testAlias(alias.alias, alias.expected);
    allResults.push(result);
    totalTests++;
    
    if (result.success) {
      passedTests++;
      log(COLORS.green, `✅ PASS (${result.latency}ms)`);
      log(COLORS.dim, `     Routed to: ${result.actualModel}`);
    } else {
      failedTests++;
      log(COLORS.red, `❌ FAIL (${result.latency}ms)`);
      if (result.providerMatch === false) {
        log(COLORS.red, `     Expected provider: ${alias.expected}, Got: ${result.actualProvider}`);
      }
      log(COLORS.red, `     Error: ${result.error || result.status}`);
    }
  }

  // ============================================
  // FINAL SUMMARY
  // ============================================
  logSection("Final Summary");

  const successRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0;
  
  log(COLORS.bold, `\n  Total Tests: ${totalTests}`);
  log(COLORS.green, `  ✅ Passed: ${passedTests}`);
  log(COLORS.red, `  ❌ Failed: ${failedTests}`);
  log(COLORS.blue, `  📊 Success Rate: ${successRate}%`);

  // Group failures by type
  const failures = allResults.filter(r => !r.success);
  if (failures.length > 0) {
    logSection("Failed Tests Detail");
    
    const comboFailures = failures.filter(r => r.testId?.startsWith("combo-"));
    const providerFailures = failures.filter(r => r.testId?.startsWith("direct-"));
    const aliasFailures = failures.filter(r => r.testId?.startsWith("alias-"));

    if (comboFailures.length > 0) {
      log(COLORS.red, `\n  Combo Failures (${comboFailures.length}):`);
      comboFailures.forEach(f => {
        log(COLORS.red, `    - ${f.testId}: ${f.error || f.status}`);
      });
    }

    if (providerFailures.length > 0) {
      log(COLORS.red, `\n  Provider Failures (${providerFailures.length}):`);
      providerFailures.forEach(f => {
        log(COLORS.red, `    - ${f.provider}/${f.model}: ${f.error || f.status}`);
      });
    }

    if (aliasFailures.length > 0) {
      log(COLORS.red, `\n  Alias Failures (${aliasFailures.length}):`);
      aliasFailures.forEach(f => {
        log(COLORS.red, `    - ${f.alias}: Expected ${f.expectedProvider}, got ${f.actualProvider || 'error'}`);
      });
    }
  }

  // Performance summary
  const successfulResults = allResults.filter(r => r.success);
  if (successfulResults.length > 0) {
    const avgLatency = Math.round(
      successfulResults.reduce((sum, r) => sum + r.latency, 0) / successfulResults.length
    );
    const maxLatency = Math.max(...successfulResults.map(r => r.latency));
    const minLatency = Math.min(...successfulResults.map(r => r.latency));
    
    logSection("Performance Summary");
    log(COLORS.blue, `  Average Latency: ${avgLatency}ms`);
    log(COLORS.blue, `  Min Latency: ${minLatency}ms`);
    log(COLORS.blue, `  Max Latency: ${maxLatency}ms`);
  }

  // Exit with appropriate code
  console.log("\n");
  process.exit(failedTests > 0 ? 1 : 0);
}

main().catch(error => {
  log(COLORS.red, "\nFatal error:", error);
  process.exit(1);
});
