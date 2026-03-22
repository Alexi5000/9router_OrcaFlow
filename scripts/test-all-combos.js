#!/usr/bin/env node
/**
 * Comprehensive Combo & Chain Test Suite for 9Router
 *
 * Tests all 5 combos + every individual model within each combo.
 * Reports pass/fail per combo (chain test) and per model (direct test).
 * Saves results to scripts/chains_status.json.
 *
 * Usage:
 *   node scripts/test-all-combos.js              # full test (all combos + all models)
 *   node scripts/test-all-combos.js --combos-only # only test combo chains, skip per-model
 *   node scripts/test-all-combos.js --no-stream   # skip streaming tests
 *   node scripts/test-all-combos.js --sequential  # test models one at a time (avoids cooldowns)
 *   node scripts/test-all-combos.js http://localhost:20128  # custom base URL
 */

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────────────────────

const BASE_URL =
  process.argv.find((a) => a.startsWith("http")) || "http://localhost:20128";
const COMBOS_ONLY = process.argv.includes("--combos-only");
const NO_STREAM = process.argv.includes("--no-stream");
// --sequential: run models one-at-a-time to avoid triggering provider cooldowns
// when many models from the same provider are in a combo (e.g. siliconflow x6).
const SEQUENTIAL = process.argv.includes("--sequential");

const TEST_PROMPT = "Reply with exactly: OK";
const MAX_TOKENS = 20;
const TIMEOUT_MS = 30_000; // 30s per request
// Concurrency for per-model tests. --sequential overrides to 1.
const MODEL_CONCURRENCY = SEQUENTIAL ? 1 : 3;
// Gap between requests in sequential mode (ms) — gives 9Router cooldown time to reset
const SEQUENTIAL_DELAY_MS = 2_000;
const RESULTS_FILE = join(__dirname, "chains_status.json");

// ── Colors ─────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

function c(color, text) {
  return `${color}${text}${C.reset}`;
}

function pad(str, len) {
  const s = String(str);
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

// Note: AbortController crashes Node.js on Windows (UV async assertion bug).
// Use Promise.race with a rejection timer instead — lets the underlying
// fetch finish naturally but surfaces a timeout error to the caller.
function fetchWithTimeout(url, options, timeoutMs = TIMEOUT_MS) {
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`timeout after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );
  return Promise.race([fetch(url, options), timeout]);
}

// ── Core test functions ─────────────────────────────────────────────────────

async function testCompletion(model) {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: TEST_PROMPT }],
        max_tokens: MAX_TOKENS,
        stream: false,
      }),
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        latency,
        status: res.status,
        error: body.slice(0, 150),
      };
    }

    const data = await res.json();
    return {
      ok: true,
      latency,
      status: res.status,
      resolvedModel: data.model || model,
      content: (data.choices?.[0]?.message?.content || "").slice(0, 80),
      usage: data.usage || null,
    };
  } catch (err) {
    return {
      ok: false,
      latency: Date.now() - start,
      error: err.message,
    };
  }
}

async function testStreaming(model) {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: TEST_PROMPT }],
        max_tokens: MAX_TOKENS,
        stream: true,
      }),
    });

    if (!res.ok) {
      return { ok: false, status: res.status };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let chunks = 0;
    let content = "";
    let resolvedModel = model;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw);
          content += parsed.choices?.[0]?.delta?.content || "";
          if (parsed.model) resolvedModel = parsed.model;
          chunks++;
        } catch {}
      }
    }

    return {
      ok: true,
      latency: Date.now() - start,
      chunks,
      content: content.slice(0, 80),
      resolvedModel,
    };
  } catch (err) {
    return {
      ok: false,
      latency: Date.now() - start,
      error: err.message,
    };
  }
}

// ── Concurrency helper ──────────────────────────────────────────────────────

async function runConcurrent(items, fn, concurrency) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      if (SEQUENTIAL && SEQUENTIAL_DELAY_MS > 0 && idx < items.length) {
        await new Promise((r) => setTimeout(r, SEQUENTIAL_DELAY_MS));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Fetch combos from API ───────────────────────────────────────────────────

async function fetchCombos() {
  const res = await fetchWithTimeout(`${BASE_URL}/api/combos`, {}, 10_000);
  if (!res.ok) throw new Error(`GET /api/combos returned ${res.status}`);
  const data = await res.json();
  return data.combos || data; // handle both { combos: [...] } and [...]
}

// ── Health check ────────────────────────────────────────────────────────────

async function healthCheck() {
  // /health returns 404 in this build; use /api/combos as reachability check
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/combos`, {}, 5_000);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Print helpers ───────────────────────────────────────────────────────────

function printHeader() {
  const line = "═".repeat(64);
  console.log(c(C.cyan + C.bold, `\n${line}`));
  console.log(
    c(C.cyan + C.bold, "  9Router Comprehensive Combo & Chain Test Suite"),
  );
  console.log(c(C.cyan + C.bold, `${line}\n`));
  console.log(`  ${c(C.dim, "Base URL:")} ${BASE_URL}`);
  console.log(
    `  ${c(C.dim, "Mode:")}     ${COMBOS_ONLY ? "Combos only" : `Full (combos + per-model)${SEQUENTIAL ? " [sequential]" : ""}`}`,
  );
  console.log(
    `  ${c(C.dim, "Streaming:")} ${NO_STREAM ? "disabled" : "enabled"}`,
  );
  console.log(`  ${c(C.dim, "Timeout:")}  ${TIMEOUT_MS / 1000}s per request`);
  console.log(`  ${c(C.dim, "Started:")}  ${new Date().toISOString()}\n`);
}

function printResult(label, result, streamResult) {
  const status = result.ok ? c(C.green, "✅ PASS") : c(C.red, "❌ FAIL");
  const latency = c(C.dim, `${result.latency}ms`);

  if (result.ok) {
    const resolved =
      result.resolvedModel && result.resolvedModel !== label
        ? c(C.dim, ` → ${result.resolvedModel}`)
        : "";
    console.log(`    ${status} ${latency}${resolved}`);
    if (result.content) {
      console.log(`    ${c(C.dim, `"${result.content}"`)}`);
    }
  } else {
    console.log(
      `    ${status} ${latency} ${c(C.red, result.error || `HTTP ${result.status}`)}`,
    );
  }

  if (streamResult) {
    const sStatus = streamResult.ok
      ? c(C.green, "✅ stream")
      : c(C.red, "❌ stream");
    const sLatency = c(C.dim, `${streamResult.latency}ms`);
    if (streamResult.ok) {
      console.log(
        `    ${sStatus} ${c(C.dim, `${streamResult.chunks} chunks`)} ${sLatency}`,
      );
    } else {
      console.log(
        `    ${sStatus} ${c(C.red, streamResult.error || `HTTP ${streamResult.status}`)}`,
      );
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  printHeader();

  // Health check
  process.stdout.write(`  Checking 9Router health... `);
  const healthy = await healthCheck();
  if (!healthy) {
    console.log(c(C.red, "❌ 9Router is not reachable at " + BASE_URL));
    process.exit(1);
  }
  console.log(c(C.green, "✅ online\n"));

  // Fetch combos
  process.stdout.write(`  Loading combos from API... `);
  let combos;
  try {
    combos = await fetchCombos();
  } catch (err) {
    console.log(c(C.red, `❌ ${err.message}`));
    process.exit(1);
  }
  console.log(c(C.green, `✅ ${combos.length} combos found\n`));

  const allResults = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    combos: {},
  };

  // ── Test each combo ───────────────────────────────────────────────────────
  for (const combo of combos) {
    const divider = "─".repeat(60);
    console.log(c(C.yellow + C.bold, `\n${divider}`));
    console.log(
      c(
        C.yellow + C.bold,
        `  COMBO: ${combo.name}  (${combo.models.length} models)`,
      ),
    );
    console.log(c(C.yellow + C.bold, divider));

    const comboResult = {
      id: combo.id,
      chainTest: null,
      streamTest: null,
      models: {},
    };

    // ── 1. Chain test (request as the combo name) ──────────────────────────
    console.log(`\n  ${c(C.magenta, "Chain test")} — model: "${combo.name}"`);
    const chainResult = await testCompletion(combo.name);
    let chainStream = null;
    if (!NO_STREAM && chainResult.ok) {
      chainStream = await testStreaming(combo.name);
    }
    printResult(combo.name, chainResult, chainStream);
    comboResult.chainTest = { ...chainResult, stream: chainStream };

    // ── 2. Per-model tests ─────────────────────────────────────────────────
    if (!COMBOS_ONLY) {
      console.log(`\n  ${c(C.blue, "Individual model tests:")}`);

      const modelTests = await runConcurrent(
        combo.models,
        async (model) => {
          const result = await testCompletion(model);
          let streamResult = null;
          if (!NO_STREAM && result.ok) {
            streamResult = await testStreaming(model);
          }
          return { model, result, streamResult };
        },
        MODEL_CONCURRENCY,
      );

      for (const { model, result, streamResult } of modelTests) {
        const label = pad(model, 45);
        const status = result.ok ? c(C.green, "✅") : c(C.red, "❌");
        process.stdout.write(`    ${status} ${c(C.dim, label)} `);

        if (result.ok) {
          const latency = c(C.dim, `${result.latency}ms`);
          const resolved =
            result.resolvedModel && result.resolvedModel !== model
              ? c(C.dim, ` → ${result.resolvedModel}`)
              : "";
          process.stdout.write(`${latency}${resolved}`);
          if (streamResult) {
            const ss = streamResult.ok
              ? c(C.green, ` | stream ${streamResult.chunks}c`)
              : c(C.red, ` | stream ❌`);
            process.stdout.write(ss);
          }
          console.log();
        } else {
          const errMsg = result.error || `HTTP ${result.status || "?"}`;
          console.log(c(C.red, `${errMsg.slice(0, 60)}`));
        }

        comboResult.models[model] = { ...result, stream: streamResult };
      }
    }

    allResults.combos[combo.name] = comboResult;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const summaryLine = "═".repeat(64);
  console.log(c(C.cyan + C.bold, `\n${summaryLine}`));
  console.log(c(C.cyan + C.bold, "  SUMMARY"));
  console.log(c(C.cyan + C.bold, summaryLine));

  let totalChains = 0,
    passedChains = 0;
  let totalModels = 0,
    passedModels = 0;

  for (const [comboName, comboResult] of Object.entries(allResults.combos)) {
    totalChains++;
    const chainOk = comboResult.chainTest?.ok;
    if (chainOk) passedChains++;

    const chainIcon = chainOk ? c(C.green, "✅") : c(C.red, "❌");
    const models = Object.entries(comboResult.models);
    const mPass = models.filter(([, r]) => r.ok).length;
    const mTotal = models.length;
    totalModels += mTotal;
    passedModels += mPass;

    const modelSummary =
      mTotal > 0
        ? `  models: ${mPass}/${mTotal} ${mPass === mTotal ? c(C.green, "all pass") : c(C.yellow, `${mTotal - mPass} fail`)}`
        : "";

    console.log(
      `\n  ${chainIcon} ${c(C.bold, pad(comboName, 10))} chain: ${chainOk ? c(C.green, "PASS") : c(C.red, "FAIL")}${modelSummary}`,
    );

    // List failing models
    for (const [model, result] of models) {
      if (!result.ok) {
        const err = result.error || `HTTP ${result.status || "?"}`;
        console.log(
          `      ${c(C.red, "✗")} ${c(C.dim, model)} — ${c(C.red, err.slice(0, 70))}`,
        );
      }
    }
  }

  console.log(
    `\n  ${c(C.bold, "Chains:")}  ${passedChains}/${totalChains} passed`,
  );
  if (!COMBOS_ONLY) {
    console.log(
      `  ${c(C.bold, "Models:")}  ${passedModels}/${totalModels} passed`,
    );
  }

  const allPassed =
    passedChains === totalChains &&
    (COMBOS_ONLY || passedModels === totalModels);
  const overallIcon = allPassed
    ? c(C.green + C.bold, "✅ ALL PASS")
    : c(C.yellow + C.bold, "⚠️  SOME FAILURES");
  console.log(`\n  Overall: ${overallIcon}`);
  console.log(c(C.cyan + C.bold, `\n${summaryLine}\n`));

  // ── Save results ──────────────────────────────────────────────────────────
  allResults.summary = {
    chainsTotal: totalChains,
    chainsPassed: passedChains,
    modelsTotal: totalModels,
    modelsPassed: passedModels,
    allPassed,
  };

  writeFileSync(RESULTS_FILE, JSON.stringify(allResults, null, 2));
  console.log(c(C.dim, `  Results saved to ${RESULTS_FILE}\n`));

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(c(C.red, `\nFatal: ${err.message}`));
  process.exit(1);
});
