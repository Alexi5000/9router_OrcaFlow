#!/usr/bin/env node
/**
 * Chain Verification Script for 9Router/Orca Flow
 * Tests each chain/combo to verify they work correctly
 * 
 * Usage: node scripts/test-chains.js [baseUrl]
 */

const BASE_URL = process.argv[2] || "http://localhost:20128";

const TEST_PROMPT = "Say 'Hello, I am working!' in exactly those words.";

// Chain configurations to test
const CHAINS = [
  { name: "opus", models: ["claude-opus-4-6", "opus"] },
  { name: "sonnet", models: ["claude-sonnet-4-6", "sonnet", "claude-sonnet-4-0"] },
  { name: "fast", models: ["fast", "groq/llama-3.3-70b-versatile"] },
  { name: "reason", models: ["reason"] },
  { name: "free", models: ["free"] },
];

// Color codes for output
const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(color, ...args) {
  console.log(color, ...args, COLORS.reset);
}

async function testChain(chainName, model) {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: TEST_PROMPT }],
        max_tokens: 50,
        stream: false,
      }),
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        status: response.status,
        error: error.slice(0, 200),
        latency,
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const actualModel = data.model || model;

    return {
      success: true,
      status: response.status,
      model: actualModel,
      content: content.slice(0, 100),
      latency,
      tokens: data.usage,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      latency: Date.now() - startTime,
    };
  }
}

async function testStreaming(chainName, model) {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: TEST_PROMPT }],
        max_tokens: 50,
        stream: true,
      }),
    });

    if (!response.ok) {
      return { success: false, status: response.status };
    }

    const reader = response.body.getReader();
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

    return {
      success: true,
      chunks,
      content: content.slice(0, 100),
      latency: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      latency: Date.now() - startTime,
    };
  }
}

async function main() {
  log(COLORS.cyan, "\n========================================");
  log(COLORS.cyan, "  9Router Chain Verification Script");
  log(COLORS.cyan, "========================================\n");
  
  log(COLORS.blue, `Base URL: ${BASE_URL}`);
  log(COLORS.blue, `Time: ${new Date().toISOString()}\n`);

  const results = [];

  for (const chain of CHAINS) {
    log(COLORS.yellow, `\n📋 Testing chain: ${chain.name}`);
    
    for (const model of chain.models) {
      process.stdout.write(`  Testing ${model}... `);
      
      // Test non-streaming
      const result = await testChain(chain.name, model);
      
      if (result.success) {
        log(COLORS.green, `✅ OK (${result.latency}ms)`);
        log(COLORS.reset, `     Model: ${result.model}`);
        log(COLORS.reset, `     Response: "${result.content.slice(0, 50)}..."`);
        if (result.tokens) {
          log(COLORS.reset, `     Tokens: ${result.tokens.prompt_tokens} prompt + ${result.tokens.completion_tokens} completion`);
        }
        
        // Test streaming
        process.stdout.write(`  Testing streaming... `);
        const streamResult = await testStreaming(chain.name, model);
        
        if (streamResult.success) {
          log(COLORS.green, `✅ OK (${streamResult.chunks} chunks, ${streamResult.latency}ms)`);
        } else {
          log(COLORS.red, `❌ FAILED: ${streamResult.error || streamResult.status}`);
        }
      } else {
        log(COLORS.red, `❌ FAILED (${result.latency}ms)`);
        log(COLORS.red, `     Status: ${result.status || "N/A"}`);
        log(COLORS.red, `     Error: ${result.error}`);
      }
      
      results.push({ chain: chain.name, model, ...result });
    }
  }

  // Summary
  log(COLORS.cyan, "\n========================================");
  log(COLORS.cyan, "  Summary");
  log(COLORS.cyan, "========================================\n");

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  log(COLORS.green, `✅ Successful: ${successful.length}`);
  log(COLORS.red, `❌ Failed: ${failed.length}`);

  if (failed.length > 0) {
    log(COLORS.red, "\nFailed chains:");
    for (const f of failed) {
      log(COLORS.red, `  - ${f.chain}/${f.model}: ${f.error || f.status}`);
    }
  }

  // Exit with error code if any failed
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  log(COLORS.red, "Fatal error:", error);
  process.exit(1);
});
