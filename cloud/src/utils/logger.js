// Logger utility for worker

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const LEVEL = LOG_LEVELS.INFO;

// ANSI color codes
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function formatInline(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  try {
    return Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" | ");
  } catch {
    return String(data);
  }
}

export function debug(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.DEBUG) {
    const extra = data ? ` | ${formatInline(data)}` : "";
    console.log(`[${formatTime()}] 🔍 [${tag}] ${message}${extra}`);
  }
}

export function info(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.INFO) {
    const extra = data ? ` | ${formatInline(data)}` : "";
    console.log(`[${formatTime()}] ℹ️  [${tag}] ${message}${extra}`);
  }
}

export function warn(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.WARN) {
    const extra = data ? ` | ${formatInline(data)}` : "";
    console.warn(`${COLORS.yellow}[${formatTime()}] ⚠️  [${tag}] ${message}${extra}${COLORS.reset}`);
  }
}

export function error(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.ERROR) {
    const extra = data ? ` | ${formatInline(data)}` : "";
    console.error(`${COLORS.red}[${formatTime()}] ❌ [${tag}] ${message}${extra}${COLORS.reset}`);
  }
}

export function request(method, path, extra) {
  const data = extra ? ` | ${formatInline(extra)}` : "";
  console.log(`[${formatTime()}] 📥 ${method} ${path}${data}`);
}

export function response(status, duration, extra) {
  const icon = status < 400 ? "📤" : "💥";
  const data = extra ? ` | ${formatInline(extra)}` : "";
  console.log(`[${formatTime()}] ${icon} ${status} (${duration}ms)${data}`);
}

export function stream(event, data) {
  const extra = data ? ` | ${formatInline(data)}` : "";
  console.log(`[${formatTime()}] 🌊 [STREAM] ${event}${extra}`);
}

// Mask sensitive data
export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
