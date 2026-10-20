const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const appRoot = path.resolve(__dirname, "..");
function normalizeDataDir(rawPath) {
  if (!rawPath) return path.join(appRoot, "data");
  if (process.platform === "win32") return rawPath;

  const winDriveMatch = rawPath.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!winDriveMatch) return rawPath;

  const [, drive, remainder] = winDriveMatch;
  return path.posix.join("/mnt", drive.toLowerCase(), remainder.replace(/\\/g, "/"));
}

const dataDir = normalizeDataDir(process.env.DATA_DIR);
const usagePath = path.join(dataDir, "usage.json");
const backupUsagePath = path.join(dataDir, "usage.json.backup-pre-scrub");
const logCandidates = [
  path.join(dataDir, "logs", "out.log"),
  path.join(dataDir, "log.txt"),
  path.join(process.env.USERPROFILE || "", ".pm2", "logs", "9router-out.log"),
].filter(Boolean);

const providerMap = {
  ANTHROPIC: "anthropic",
  ANTIGRAVITY: "antigravity",
  CLAUDE: "claude",
  CODEX: "codex",
  CURSOR: "cursor",
  GEMINI: "gemini",
  "GEMINI-CLI": "gemini-cli",
  GITHUB: "github",
  GROQ: "groq",
  IFLOW: "iflow",
  KILOCODE: "kilocode",
  KIRO: "kiro",
  OPENAI: "openai",
  OPENROUTER: "openrouter",
  QWEN: "qwen",
  SILICONFLOW: "siliconflow",
};

function normalizeProvider(raw) {
  return providerMap[raw] || String(raw || "").toLowerCase();
}

function stripAnsi(line) {
  return line.replace(/\u001b\[[0-9;]*m/g, "");
}

function parseIsoPrefix(line) {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}):/);
  if (!match) return null;
  return `${match[1]}T${match[2]}.000Z`;
}

function parseLegacyTimestamp(raw) {
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}:\d{2}:\d{2})$/);
  if (!match) return null;
  const [, day, month, year, time] = match;
  return `${year}-${month}-${day}T${time}.000Z`;
}

function openUsage(file, writable = false) {
  const flags = (writable ? fs.constants.O_RDWR : fs.constants.O_RDONLY) |
    (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
  const fd = fs.openSync(file, flags);
  try {
    const stat = fs.fstatSync(fd);
    const named = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || named.isSymbolicLink() ||
        stat.dev !== named.dev || stat.ino !== named.ino ||
        (writable && process.platform !== "win32" && stat.uid !== process.getuid())) {
      throw new Error("Usage source must be a single-link regular file");
    }
    const text = fs.readFileSync(fd, "utf8");
    const data = JSON.parse(text);
    if (!Array.isArray(data.history)) data.history = [];
    return { fd, text, data };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function loadUsage(file) {
  const opened = openUsage(file);
  try {
    return opened.data;
  } finally {
    fs.closeSync(opened.fd);
  }
}

function makeDedupKey(entry) {
  const t = entry.tokens || {};
  return [
    entry.timestamp,
    entry.provider,
    entry.model,
    t.prompt_tokens || t.input_tokens || 0,
    t.completion_tokens || t.output_tokens || 0,
    t.cached_tokens || t.cache_read_input_tokens || 0,
  ].join("|");
}

function mergeHistorySets(...sets) {
  const merged = [];
  const seen = new Set();

  for (const entries of sets) {
    for (const entry of entries || []) {
      if (!entry?.timestamp || !entry?.provider || !entry?.model) continue;
      const key = makeDedupKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
  }

  merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return merged;
}

function makeEntry({ provider, model, timestamp, promptTokens, completionTokens, cacheRead = 0, cost = 0 }) {
  const entry = {
    provider,
    model,
    timestamp,
    status: "ok",
    cost,
    tokens: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
    },
  };

  if (cacheRead > 0) {
    entry.tokens.cached_tokens = cacheRead;
    entry.tokens.cache_read_input_tokens = cacheRead;
  }

  return entry;
}

async function recoverFromStructuredLog(logPath) {
  if (!fs.existsSync(logPath)) return [];

  const pendingEnds = new Map();
  const recovered = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of rl) {
    const line = stripAnsi(rawLine);

    let match = line.match(/\[PENDING\] END(?: \(ERROR\))? \| provider=([^|]+) \| model=(.+)$/);
    if (match) {
      const provider = String(match[1]).trim().toLowerCase();
      const model = String(match[2]).trim();
      const timestamp = parseIsoPrefix(line);
      if (!pendingEnds.has(provider)) pendingEnds.set(provider, []);
      pendingEnds.get(provider).push({ model, timestamp });
      if (pendingEnds.get(provider).length > 1000) {
        pendingEnds.get(provider).splice(0, pendingEnds.get(provider).length - 1000);
      }
      continue;
    }

    match = line.match(/\[USAGE\] ([A-Z0-9-]+) \| in=(\d+) \| out=(\d+) \| account=([^|]+?)(?: \| cache_read=(\d+))?$/);
    if (!match) continue;

    const provider = normalizeProvider(String(match[1]).trim());
    const promptTokens = Number(match[2]);
    const completionTokens = Number(match[3]);
    const cacheRead = match[5] ? Number(match[5]) : 0;
    const timestamp = parseIsoPrefix(line);
    if (!timestamp) continue;

    const queue = pendingEnds.get(provider) || [];
    let model = null;
    for (let i = queue.length - 1; i >= 0; i--) {
      const pending = queue[i];
      if (!pending.timestamp) continue;
      const delta = Math.abs(new Date(timestamp).getTime() - new Date(pending.timestamp).getTime());
      if (delta <= 30000) {
        model = pending.model;
        queue.splice(i, 1);
        break;
      }
    }

    recovered.push(
      makeEntry({
        provider,
        model: model || `${provider}-recovered`,
        timestamp,
        promptTokens,
        completionTokens,
        cacheRead,
      })
    );
  }

  return recovered;
}

async function recoverFromLegacyLog(logPath) {
  if (!fs.existsSync(logPath)) return [];

  const recovered = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of rl) {
    const line = stripAnsi(rawLine).trim();
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 7) continue;

    const timestamp = parseLegacyTimestamp(parts[0]);
    if (!timestamp) continue;

    const [_, model, providerRaw, __account, promptRaw, completionRaw, statusRaw] = parts;
    if (!/200 OK/i.test(statusRaw || "")) continue;

    const promptTokens = Number(promptRaw);
    const completionTokens = Number(completionRaw);
    if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) continue;

    recovered.push(
      makeEntry({
        provider: normalizeProvider(providerRaw),
        model,
        timestamp,
        promptTokens,
        completionTokens,
      })
    );
  }

  return recovered;
}

async function recoverFromLogs() {
  const recovered = [];

  for (const logPath of logCandidates) {
    if (!fs.existsSync(logPath)) continue;
    if (logPath.endsWith("log.txt")) {
      recovered.push(...await recoverFromLegacyLog(logPath));
    } else {
      recovered.push(...await recoverFromStructuredLog(logPath));
    }
  }

  return recovered;
}

function summarize(history) {
  return {
    total: history.length,
    first: history[0]?.timestamp || null,
    last: history[history.length - 1]?.timestamp || null,
  };
}

async function recover() {
  const opened = openUsage(usagePath, true);
  try {
    const current = opened.data;
    const backup = loadUsage(backupUsagePath);
    const recovered = await recoverFromLogs();

    const mergedHistory = mergeHistorySets(backup.history, current.history, recovered);

    const safetyDir = process.env.NINEROUTER_BACKUP_DIR || path.join(os.tmpdir(), "9router-usage-backups");
    fs.mkdirSync(safetyDir, { recursive: true, mode: 0o700 });
    const safetyStat = fs.lstatSync(safetyDir);
    if (!safetyStat.isDirectory() || safetyStat.isSymbolicLink() ||
        (process.platform !== "win32" &&
         (safetyStat.uid !== process.getuid() || (safetyStat.mode & 0o022) !== 0))) {
      throw new Error("Recovery backup directory must be owned and protected");
    }
    const privateSafetyDir = fs.mkdtempSync(path.join(safetyDir, "usage-restore-"));
    const safetyPath = path.join(privateSafetyDir, "usage.json");
    fs.writeFileSync(safetyPath, opened.text, { flag: "wx", mode: 0o600 });

    const nextUsage = {
      ...backup,
      ...current,
      history: mergedHistory,
    };

    const bytes = Buffer.from(JSON.stringify(nextUsage, null, 2));
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(opened.fd, bytes, offset, bytes.length - offset, offset);
      if (written <= 0) throw new Error("Usage recovery write made no progress");
      offset += written;
    }
    fs.ftruncateSync(opened.fd, bytes.length);

    console.log(
      JSON.stringify(
        {
          usagePath,
          backupUsagePath,
          safetyPath,
          current: summarize(current.history),
          backup: summarize(backup.history),
          recoveredFromLogs: summarize(recovered),
          merged: summarize(mergedHistory),
        },
        null,
        2
      )
    );
  } finally {
    fs.closeSync(opened.fd);
  }
}

recover().catch((error) => {
  console.error(error);
  process.exit(1);
});
