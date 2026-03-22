#!/usr/bin/env node
/**
 * 9Router → Postgres Token Usage Live Sync
 * Runs on ALEXPC3. Polls 9Router's usage API every 60s and
 * syncs to AlexPC's techtide_unified.token_usage table.
 *
 * PM2: pm2 start scripts/sync-usage.mjs --name token-sync
 */
import pg from "pg";
const { Pool } = pg;

const ROUTER_API = process.env.ROUTER_API || "http://localhost:20128";
const PG_URL = process.env.DATABASE_URL || "postgresql://techtide:techtide_dev_password@192.168.137.181:5432/techtide_unified";
const POLL_MS = parseInt(process.env.POLL_MS || "60000", 10);

const pool = new Pool({ connectionString: PG_URL, max: 2 });
let lastSyncTs = null;

async function getLastSync() {
  if (lastSyncTs) return lastSyncTs;
  const r = await pool.query("SELECT MAX(ts) AS latest FROM token_usage WHERE framework='9router'");
  lastSyncTs = r.rows[0]?.latest || "2026-01-01T00:00:00Z";
  return lastSyncTs;
}

async function syncRecent() {
  try {
    const resp = await fetch(`${ROUTER_API}/api/usage/history`);
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    const since = await getLastSync();
    const recent = (data.recentRequests || []).filter(r => r.timestamp && new Date(r.timestamp) > new Date(since));
    if (!recent.length) return;
    const vals = [];
    const phs = [];
    let i = 1;
    for (const r of recent) {
      phs.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},0,0,null,null,null,null,$${i++},null,$${i++})`);
      vals.push(`9router-${r.provider||"unknown"}`,"9router","9router","9router",r.provider||"unknown",r.model||"unknown",r.promptTokens||0,r.completionTokens||0,r.status||"ok",r.timestamp);
    }
    await pool.query(`INSERT INTO token_usage(agent_id,agent_squad,framework,service,provider,model,input_tokens,output_tokens,cache_read,cache_create,request_id,task_id,session_id,latency_ms,status,cost_usd,ts) VALUES ${phs.join(",")}`, vals);
    lastSyncTs = recent.reduce((m,r) => r.timestamp>m?r.timestamp:m, since);
    console.log(`[${new Date().toLocaleTimeString()}] Synced ${recent.length} entries`);
  } catch (e) { console.error(`[sync] ${e.message}`); }
}

async function fullSync() {
  try {
    const resp = await fetch(`${ROUTER_API}/api/usage/history`);
    if (!resp.ok) return;
    const data = await resp.json();
    const byModel = data.byModel || {};
    if (!Object.keys(byModel).length) return;
    await pool.query("DELETE FROM token_usage WHERE framework='9router' AND agent_squad='9router'");
    const vals = [];
    const phs = [];
    let i = 1;
    for (const [,s] of Object.entries(byModel)) {
      phs.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},0,0,null,null,null,null,'ok',$${i++},$${i++})`);
      vals.push(`9router-${s.provider||"unknown"}`,"9router","9router","9router",s.provider||"unknown",s.rawModel||"unknown",s.promptTokens||0,s.completionTokens||0,s.cost||0,s.lastUsed);
    }
    await pool.query(`INSERT INTO token_usage(agent_id,agent_squad,framework,service,provider,model,input_tokens,output_tokens,cache_read,cache_create,request_id,task_id,session_id,latency_ms,status,cost_usd,ts) VALUES ${phs.join(",")}`, vals);
    console.log(`[full] Refreshed ${Object.keys(byModel).length} models`);
  } catch (e) { console.error(`[full] ${e.message}`); }
}

console.log(`[token-sync] Started — polling every ${POLL_MS/1000}s`);
await syncRecent();
await fullSync();
let c = 0;
setInterval(async () => { await syncRecent(); if (++c>=10) { await fullSync(); c=0; } }, POLL_MS);
