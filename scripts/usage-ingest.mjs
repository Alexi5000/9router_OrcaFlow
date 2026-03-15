#!/usr/bin/env node
/**
 * 9router-usage-ingest.js
 * Summarizes yesterday's 9Router usage and stores it in the Second Brain.
 * Run daily via PM2 cron or Windows Task Scheduler.
 *
 * Usage: node 9router-usage-ingest.js [--date YYYY-MM-DD]
 */
import { readFile } from 'fs/promises';
import { resolve, posix } from 'path';

function normalizeDataDir(rawPath) {
  if (!rawPath) return resolve('C:/TechTide/Tools/9router/data');
  if (process.platform === 'win32') return rawPath;

  const winDriveMatch = rawPath.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!winDriveMatch) return rawPath;

  const [, drive, remainder] = winDriveMatch;
  return posix.join('/mnt', drive.toLowerCase(), remainder.replace(/\\/g, '/'));
}

const DATA_DIR = normalizeDataDir(process.env.DATA_DIR);
const USAGE_FILE = resolve(DATA_DIR, 'usage.json');
const AXEL_API = process.env.AXEL_API_URL || 'http://localhost:4000';
const USER_ID = process.env.AXEL_USER_ID || '00000000-0000-0000-0000-000000000001';

// Parse optional --date flag, default to yesterday
const dateArg = process.argv.find((_, i, a) => a[i - 1] === '--date');
const targetDate = dateArg || new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function main() {
  console.log(`[ingest] Summarizing 9Router usage for ${targetDate}`);

  const raw = await readFile(USAGE_FILE, 'utf-8');
  const { history } = JSON.parse(raw);

  // Filter entries for the target date
  const entries = (history || []).filter(e => e.timestamp?.startsWith(targetDate));

  if (entries.length === 0) {
    console.log('[ingest] No entries for this date, skipping.');
    return;
  }

  // Aggregate
  let totalPrompt = 0, totalCompletion = 0, totalCost = 0;
  const byProvider = {};
  const byModel = {};

  for (const e of entries) {
    const pt = e.tokens?.prompt_tokens || 0;
    const ct = e.tokens?.completion_tokens || 0;
    const cost = e.cost || 0;
    totalPrompt += pt;
    totalCompletion += ct;
    totalCost += cost;

    const provider = e.provider || 'unknown';
    byProvider[provider] = (byProvider[provider] || 0) + 1;

    const model = e.model || 'unknown';
    byModel[model] = (byModel[model] || 0) + 1;
  }

  // Build summary text
  const providerLines = Object.entries(byProvider)
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => `${p}: ${c} requests`)
    .join(', ');

  const modelLines = Object.entries(byModel)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([m, c]) => `${m}: ${c}`)
    .join(', ');

  const summary = [
    `9Router daily usage summary for ${targetDate}:`,
    `${entries.length} total requests.`,
    `Tokens: ${totalPrompt.toLocaleString()} prompt, ${totalCompletion.toLocaleString()} completion.`,
    `Estimated cost: $${totalCost.toFixed(4)}.`,
    `By provider: ${providerLines}.`,
    `Top models: ${modelLines}.`,
  ].join(' ');

  console.log(`[ingest] Summary: ${summary}`);

  // Store in Second Brain
  const res = await fetch(`${AXEL_API}/api/memory/process-memory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': USER_ID,
    },
    body: JSON.stringify({ content: summary }),
  });

  if (!res.ok) {
    console.error(`[ingest] Failed to store: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log(`[ingest] Stored: ${result.message}`);
}

main().catch(err => {
  console.error('[ingest] Error:', err.message);
  process.exit(1);
});
