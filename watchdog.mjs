/**
 * 9Router Watchdog
 * Runs every 5 minutes via PM2. Clears stale model locks and resets
 * unavailable connections that have expired cooldowns.
 *
 * Strategy:
 *   1. Login once, get session cookie
 *   2. Fetch all provider connections
 *   3. For each connection marked unavailable:
 *      - Check if ALL its modelLock_* timestamps are in the past
 *      - If yes, reset testStatus → active, clear expired locks, reset backoffLevel
 *   4. Trim request-details.json if it exceeds MAX_LINES
 */

import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:20128";
const PASSWORD = process.env.INITIAL_PASSWORD || "[REDACTED-ROTATED]";
const DATA_DIR = process.env.DATA_DIR || path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE || "C:/Users/Admin", "AppData", "Roaming"),
  "9router"
);
const DB_FILE = path.join(DATA_DIR, "db.json");
const REQUEST_DETAILS_FILE = path.join(DATA_DIR, "request-details.json");
const MAX_LINES = 50_000; // ~50k log entries max before trim

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [WATCHDOG] ${msg}`);
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  // Extract Set-Cookie
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("No session cookie returned");
  // Return just the first name=value pair
  return cookie.split(";")[0];
}

async function getConnections(cookie) {
  const res = await fetch(`${BASE}/api/providers`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) throw new Error(`GET /api/providers failed: ${res.status}`);
  const data = await res.json();
  return data.connections || [];
}

async function resetConnection(id, clearKeys, cookie) {
  const updateData = {
    testStatus: "active",
    lastError: null,
    lastErrorAt: null,
  };
  // Include the null-cleared lock keys via providerSpecificData? No — the PUT
  // route does not forward modelLock_* keys. We write directly to db.json
  // for the lock cleanup, then call PUT for testStatus reset.
  const res = await fetch(`${BASE}/api/providers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(updateData),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT /api/providers/${id} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Direct DB patch for model lock keys (not exposed via API)
function clearLocksInDb(connectionId, lockKeys) {
  if (lockKeys.length === 0) return;
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const db = JSON.parse(raw);
    const conn = db.providerConnections?.find((c) => c.id === connectionId);
    if (!conn) return;
    let changed = false;
    for (const key of lockKeys) {
      if (Object.prototype.hasOwnProperty.call(conn, key)) {
        delete conn[key];
        changed = true;
      }
    }
    // Also reset backoffLevel if clearing
    if (changed && conn.backoffLevel > 0) {
      conn.backoffLevel = 0;
      conn.updatedAt = new Date().toISOString();
    }
    if (changed) {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
    }
  } catch (err) {
    log(`DB patch error for ${connectionId}: ${err.message}`);
  }
}

// ── Log trim ─────────────────────────────────────────────────────────────────

function trimRequestDetails() {
  try {
    if (!fs.existsSync(REQUEST_DETAILS_FILE)) return;
    const stat = fs.statSync(REQUEST_DETAILS_FILE);
    const sizeMB = stat.size / 1024 / 1024;
    if (sizeMB < 50) return; // Only trim if > 50 MB

    log(`request-details.json is ${sizeMB.toFixed(0)} MB — trimming...`);
    fs.writeFileSync(REQUEST_DETAILS_FILE, "[]", "utf8");
    log("request-details.json trimmed to empty.");
  } catch (err) {
    log(`Trim error: ${err.message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const now = Date.now();

  // 1. Trim log if bloated
  trimRequestDetails();

  // 2. Login
  let cookie;
  try {
    cookie = await login();
  } catch (err) {
    log(`Auth error: ${err.message}`);
    return;
  }

  // 3. Fetch connections
  let connections;
  try {
    connections = await getConnections(cookie);
  } catch (err) {
    log(`Fetch error: ${err.message}`);
    return;
  }

  // 4. Find connections with stale locks
  let fixed = 0;
  for (const conn of connections) {
    if (!conn.isActive) continue;

    const lockKeys = Object.keys(conn).filter((k) => k.startsWith("modelLock_"));
    const expiredLocks = lockKeys.filter((k) => {
      const val = conn[k];
      if (!val) return true; // null lock = clear it
      return new Date(val).getTime() <= now; // past expiry
    });
    const activeLocks = lockKeys.filter((k) => {
      const val = conn[k];
      return val && new Date(val).getTime() > now;
    });

    const isStuckUnavailable =
      conn.testStatus === "unavailable" &&
      activeLocks.length === 0; // no locks still valid

    if (isStuckUnavailable || expiredLocks.length > 0) {
      const provider = conn.provider || conn.id?.slice(0, 8);

      if (expiredLocks.length > 0) {
        clearLocksInDb(conn.id, expiredLocks);
        log(`${provider} | cleared ${expiredLocks.length} expired lock(s): ${expiredLocks.map(k => k.replace("modelLock_","")).join(", ")}`);
      }

      if (isStuckUnavailable) {
        try {
          await resetConnection(conn.id, expiredLocks, cookie);
          log(`${provider} | reset: unavailable → active`);
          fixed++;
        } catch (err) {
          log(`${provider} | reset failed: ${err.message}`);
        }
      }
    }
  }

  if (fixed === 0 && connections.length > 0) {
    log(`All ${connections.length} connections healthy.`);
  } else if (fixed > 0) {
    log(`Fixed ${fixed} stuck connection(s).`);
  }
}

run().catch((err) => {
  console.error("[WATCHDOG] Fatal:", err.message);
  process.exit(1);
});
