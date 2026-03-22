/**
 * Helper utilities for 9Router tests
 */

/**
 * Parse JSON response from 9Router server
 * Handles the case where server appends streaming markers
 */
export async function parseRouterResponse(response) {
  const text = await response.text();

  // Handle streaming responses
  if (text.includes("data: [DONE]")) {
    const jsonStr = text.split("\n")[0];
    return JSON.parse(jsonStr);
  }

  // Handle pure JSON responses
  return JSON.parse(text);
}

/**
 * Make a chat completion request
 */
export async function chatCompletion(baseUrl, options) {
  const {
    model,
    messages,
    max_tokens = 20,
    stream = false,
    temperature,
    top_p,
    stop,
    ...rest
  } = options;

  const body = {
    model,
    messages,
    max_tokens,
    stream,
    ...rest,
  };

  if (temperature !== undefined) body.temperature = temperature;
  if (top_p !== undefined) body.top_p = top_p;
  if (stop !== undefined) body.stop = stop;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return res;
}

/**
 * Test all combos and return results
 */
export async function testAllCombos(baseUrl, prompt = "Say 'OK'") {
  const combos = ["opus", "sonnet", "fast", "build", "reason"];
  const results = [];

  for (const combo of combos) {
    const start = Date.now();

    try {
      const res = await chatCompletion(baseUrl, {
        model: combo,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 10,
      });

      const latency = Date.now() - start;
      const data = res.ok ? await parseRouterResponse(res) : null;

      results.push({
        combo,
        status: res.status,
        latency,
        model: data?.model || "N/A",
        content: data?.choices?.[0]?.message?.content?.slice(0, 30) || "",
        success: res.status === 200,
      });
    } catch (error) {
      results.push({
        combo,
        status: 0,
        latency: Date.now() - start,
        model: "ERROR",
        content: error.message.slice(0, 30),
        success: false,
      });
    }
  }

  return results;
}

/**
 * Test a specific provider
 */
export async function testProvider(
  baseUrl,
  provider,
  model,
  prompt = "Say 'OK'",
) {
  const start = Date.now();

  const res = await chatCompletion(baseUrl, {
    model: `${provider}/${model}`,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 10,
  });

  const latency = Date.now() - start;
  const data = res.ok ? await parseRouterResponse(res) : null;

  return {
    provider,
    model,
    status: res.status,
    latency,
    actualModel: data?.model || "N/A",
    content: data?.choices?.[0]?.message?.content?.slice(0, 30) || "",
    success: res.status === 200,
  };
}

/**
 * Print test results in a formatted table
 */
export function printResults(title, results) {
  console.log(`\n${title}`);
  console.log("=".repeat(60));

  results.forEach((r) => {
    const status = r.success ? "OK" : "FAIL";
    const latency = `${r.latency}ms`.padStart(7);
    const label = `${status} ${r.combo || r.provider}`.padEnd(15);
    console.log(
      `${label} -> ${(r.model || r.actualModel).padEnd(30)} ${latency}`,
    );
  });

  const successCount = results.filter((r) => r.success).length;
  console.log(`\n${successCount}/${results.length} passed`);
}
