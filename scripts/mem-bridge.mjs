#!/usr/bin/env node
/**
 * mem-bridge.mjs
 * Fetches yesterday's high-value claude-mem observations and stores them
 * in the Second Brain (Axel) as episodic memories.
 *
 * Run daily via PM2 cron — follows the 9router-usage-ingest pattern.
 * Usage: node mem-bridge.mjs [--date YYYY-MM-DD] [--dry-run]
 */

const CLAUDE_MEM_URL = process.env.CLAUDE_MEM_URL || "http://localhost:37777";
const AXEL_API = process.env.AXEL_API_URL || "http://localhost:4000";
const USER_ID =
  process.env.AXEL_USER_ID || "00000000-0000-0000-0000-000000000001";
const MIN_LENGTH = parseInt(process.env.MIN_CONTENT_LENGTH || "60", 10);
const POST_DELAY_MS = parseInt(process.env.POST_DELAY_MS || "200", 10);
const DRY_RUN = process.argv.includes("--dry-run");

// Parse optional --date flag, default to yesterday
const dateArg = process.argv.find((_, i, a) => a[i - 1] === "--date");
const targetDate = dateArg
  ? dateArg
  : new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Fetch all observations from claude-mem (paginated)
// ---------------------------------------------------------------------------
async function fetchObservations() {
  const all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(
      `${CLAUDE_MEM_URL}/api/observations?limit=${limit}&offset=${offset}`,
    );
    if (!res.ok)
      throw new Error(`claude-mem HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const items = Array.isArray(data)
      ? data
      : (data.observations ?? data.data ?? []);

    if (items.length === 0) break;
    all.push(...items);
    if (items.length < limit) break; // last page
    offset += limit;
    if (all.length >= 2000) break; // safety cap
  }

  return all;
}

// ---------------------------------------------------------------------------
// Quality filter — only bridge observations worth storing long-term
// ---------------------------------------------------------------------------
function isHighValue(obs) {
  const content = String(obs.content ?? "").trim();
  if (content.length < MIN_LENGTH) return false;

  // Skip trivial tool calls that add no knowledge (file listings, empty responses)
  const tool = (obs.tool_name ?? obs.toolName ?? "").toLowerCase();
  const NOISY_TOOLS = ["glob", "todowrite"];
  if (NOISY_TOOLS.includes(tool) && content.length < 150) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Build a readable content string for Axel's process-memory endpoint
// ---------------------------------------------------------------------------
function composeContent(obs) {
  const ts = obs.timestamp ?? obs.created_at ?? obs.createdAt ?? "unknown time";
  const tool = obs.tool_name ?? obs.toolName ?? "";
  const cwd = obs.cwd ?? "";
  const content = String(obs.content ?? "").trim();
  const session = obs.contentSessionId ?? obs.sessionId ?? "";

  const parts = [`Claude Code session observation [${ts}]:`];
  if (tool) parts.push(`Tool used: ${tool}.`);
  if (cwd) parts.push(`Working directory: ${cwd}.`);
  parts.push(content);
  if (session) parts.push(`(Session ${session.slice(0, 8)})`);

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// POST a single content string to Axel's memory pipeline
// ---------------------------------------------------------------------------
async function storeInAxel(content) {
  const res = await fetch(`${AXEL_API}/api/memory/process-memory`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": USER_ID,
    },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) throw new Error(`Axel HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(
    `[mem-bridge] Bridging claude-mem → Axel for ${targetDate}` +
      (DRY_RUN ? " (DRY RUN)" : ""),
  );

  // 1. Fetch observations — soft-fail if worker isn't running
  let observations;
  try {
    observations = await fetchObservations();
  } catch (err) {
    console.warn(
      `[mem-bridge] Could not reach claude-mem at ${CLAUDE_MEM_URL}: ${err.message}`,
    );
    console.warn("[mem-bridge] Worker may be stopped — skipping. Exit 0.");
    return; // not a hard failure; worker self-manages
  }

  // 2. Filter to target date
  const dated = observations.filter((obs) => {
    const ts = String(obs.timestamp ?? obs.created_at ?? obs.createdAt ?? "");
    return ts.startsWith(targetDate);
  });

  console.log(
    `[mem-bridge] ${observations.length} total observations, ` +
      `${dated.length} on ${targetDate}`,
  );

  // 3. Quality filter
  const valuable = dated.filter(isHighValue);
  console.log(
    `[mem-bridge] ${valuable.length} pass quality filter ` +
      `(min ${MIN_LENGTH} chars, skip noisy tools)`,
  );

  if (valuable.length === 0) {
    console.log("[mem-bridge] Nothing to bridge today. Done.");
    return;
  }

  // 4. Store each in Axel
  let stored = 0;
  let failed = 0;

  for (const obs of valuable) {
    const content = composeContent(obs);

    if (DRY_RUN) {
      console.log(`[mem-bridge] [DRY] ${content.slice(0, 120)}…`);
      stored++;
      continue;
    }

    try {
      const result = await storeInAxel(content);
      console.log(`[mem-bridge] ✓ ${result.message ?? "stored"}`);
      stored++;
      // Small pause — Axel runs AI extraction per call; don't hammer it
      if (POST_DELAY_MS > 0)
        await new Promise((r) => setTimeout(r, POST_DELAY_MS));
    } catch (err) {
      console.error(`[mem-bridge] ✗ ${err.message}`);
      failed++;
    }
  }

  console.log(`[mem-bridge] Done — ${stored} stored, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[mem-bridge] Fatal:", err.message);
  process.exit(1);
});
