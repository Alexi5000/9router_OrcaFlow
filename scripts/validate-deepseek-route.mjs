import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:20128";
const STREAM_PERIOD = process.env.USAGE_PERIOD || "24h";
const TIMEOUT_MS = Number(process.env.VALIDATION_TIMEOUT_MS || 30000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  assert(
    response.ok,
    `Request failed for ${url}: ${response.status} ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function getPm2Apps() {
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"]);
    const lines = String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const candidate = lines[index];
      if (!candidate.startsWith("[")) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep scanning for the JSON payload.
      }
    }
  } catch {
    return [];
  }
  return [];
}

async function verifyRuntime() {
  const version = await getJson(`${BASE_URL}/api/version`);
  const pm2Apps = await getPm2Apps();
  const routerApp = pm2Apps.find((app) => app.name === "9router") || null;
  const watchdogApp =
    pm2Apps.find((app) => app.name === "9router-watchdog") || null;

  assert(version.currentVersion, "Missing currentVersion from /api/version");
  assert(
    routerApp?.pm2_env?.status === "online",
    "PM2 9router app is not online",
  );
  assert(Boolean(watchdogApp), "PM2 9router-watchdog app is not registered");

  return {
    version: version.currentVersion,
    routerStatus: routerApp.pm2_env.status,
    watchdogStatus: watchdogApp.pm2_env?.status || "stopped",
  };
}

async function verifyNonStreaming() {
  const payload = await getJson(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      stream: false,
      max_tokens: 48,
      messages: [
        {
          role: "user",
          content: "Reply with exactly DEEPSEEK_SYNC_OK",
        },
      ],
    }),
  });

  const content = payload?.choices?.[0]?.message?.content || "";
  assert(
    String(content).includes("DEEPSEEK_SYNC_OK"),
    "Non-streaming DeepSeek response did not contain the expected marker",
  );

  return {
    requestedModel: "deepseek-chat",
    finalModel: payload.model || null,
    content,
  };
}

async function watchUsageStream(matchers = []) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BASE_URL}/api/usage/stream?period=${STREAM_PERIOD}`,
      {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      },
    );
    assert(response.ok, `Usage stream request failed: ${response.status}`);
    assert(response.body, "Usage stream did not return a readable body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const dataLines = event
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6));

        if (!dataLines.length) continue;

        const raw = dataLines.join("\n");
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }

        for (const matcher of matchers) {
          if (matcher(parsed)) {
            controller.abort();
            return parsed;
          }
        }
      }
    }

    throw new Error(
      "Usage stream ended before the expected DeepSeek event was observed",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyStreaming() {
  const streamWatcher = watchUsageStream([
    (payload) =>
      Array.isArray(payload?.activeRequests) &&
      payload.activeRequests.some((entry) => {
        const route = String(entry.routeSummary || "");
        return (
          route.includes("deepseek-code") ||
          route.includes("deepseek/deepseek-chat")
        );
      }),
    (payload) =>
      Array.isArray(payload?.recentRequests) &&
      payload.recentRequests.some((entry) => {
        const route = String(entry.routeSummary || "");
        return (
          route.includes("deepseek-code") ||
          route.includes("deepseek/deepseek-chat")
        );
      }),
  ]);

  await sleep(500);

  const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-code",
      stream: true,
      max_tokens: 128,
      messages: [
        {
          role: "user",
          content:
            "Output a numbered list of 12 short coding concepts, one per line, prefixed with DS.",
        },
      ],
    }),
  });

  assert(response.ok, `Streaming DeepSeek request failed: ${response.status}`);
  assert(
    response.body,
    "Streaming DeepSeek request did not return a readable body",
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let chunkCount = 0;
  let sawDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    if (text.includes("data: ")) chunkCount += 1;
    if (text.includes("[DONE]")) sawDone = true;
  }

  assert(
    chunkCount > 0,
    "Streaming DeepSeek request did not yield any SSE data chunks",
  );

  const streamPayload = await streamWatcher;
  const details = await getJson(
    `${BASE_URL}/api/usage/request-details?page=1&pageSize=10`,
  );
  const match = (details.details || []).find((entry) => {
    const route = String(entry.routeSummary || "");
    return route.includes("deepseek-code");
  });

  assert(
    Boolean(match),
    "Did not find a recorded request-detail entry for deepseek-code",
  );

  return {
    requestedModel: "deepseek-code",
    sawDone,
    sseChunks: chunkCount,
    streamKind: streamPayload.kind || null,
    finalProvider: match.provider,
    finalModel: match.model,
    routeSummary: match.routeSummary,
  };
}

async function main() {
  const runtime = await verifyRuntime();
  const sync = await verifyNonStreaming();
  const streaming = await verifyStreaming();

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtime,
        sync,
        streaming,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message || String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
