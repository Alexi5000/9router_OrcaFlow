const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const port = process.env.PORT || "20128";
const pm2AppName = process.env.PM2_APP_NAME || "9router";
const ecosystemPath = path.join(appRoot, "ecosystem.config.cjs");
const nextDir = path.join(appRoot, ".next");
const standaloneDir = path.join(nextDir, "standalone");
const staticDir = path.join(nextDir, "static");

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    env: process.env,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`[redeploy] ${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: "utf8",
    env: process.env,
    ...options,
  });

  return {
    status: result.status ?? 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function parsePm2Json(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index];
    if (!candidate.startsWith("[")) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep looking for the actual JSON payload.
    }
  }

  throw new Error("[redeploy] Unable to parse PM2 state");
}

function cleanPreviousBuild() {
  fs.rmSync(standaloneDir, { recursive: true, force: true });
  fs.rmSync(staticDir, { recursive: true, force: true });
}

function stopPm2App() {
  const status = runCapture("pm2", ["jlist"]);
  if (status.status !== 0) {
    throw new Error("[redeploy] Unable to query PM2 state");
  }

  const apps = parsePm2Json(status.stdout || "[]");
  const exists = apps.some((app) => app.name === pm2AppName);
  if (!exists) return;

  const describe = apps.find((app) => app.name === pm2AppName);
  if (describe?.pm2_env?.status === "stopped") return;

  runCommand("pm2", ["stop", pm2AppName]);
}

function startPm2App() {
  runCommand("pm2", ["startOrRestart", ecosystemPath, "--only", pm2AppName]);
  runCommand("pm2", ["save"]);
}

function assertStandaloneOutput() {
  const serverPath = path.join(standaloneDir, "server.js");
  if (!fs.existsSync(serverPath)) {
    throw new Error(`[redeploy] Missing standalone server bundle at ${serverPath}`);
  }
  if (!fs.existsSync(staticDir)) {
    throw new Error(`[redeploy] Missing static build assets at ${staticDir}`);
  }
  const staticEntries = fs.readdirSync(staticDir);
  if (!staticEntries.length) {
    throw new Error(`[redeploy] Static build assets directory is empty: ${staticDir}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyLiveApp() {
  const loginUrl = `http://127.0.0.1:${port}/login`;
  const versionUrl = `http://127.0.0.1:${port}/api/version`;

  let html = "";
  for (let attempt = 1; attempt <= 20; attempt++) {
    const login = await fetch(loginUrl).catch(() => null);
    const version = await fetch(versionUrl).catch(() => null);
    if (login?.ok && version?.ok) {
      html = await login.text();
      break;
    }
    await sleep(1000);
  }

  if (!html) {
    throw new Error("[redeploy] Live app did not become ready after restart");
  }

  const chunkMatch = html.match(/\/_next\/static\/chunks\/app\/login\/page-[^"]+\.js/);
  if (!chunkMatch) {
    throw new Error("[redeploy] Could not find login page chunk in live HTML");
  }

  const chunkUrl = `http://127.0.0.1:${port}${chunkMatch[0]}`;
  const chunkResponse = await fetch(chunkUrl).catch(() => null);
  if (!chunkResponse?.ok) {
    throw new Error(`[redeploy] Login chunk probe failed for ${chunkUrl}`);
  }

  console.log(`[redeploy] Live HTML references ${chunkMatch[0]}`);
}

async function main() {
  console.log("[redeploy] Stopping PM2 app before rebuild");
  stopPm2App();

  console.log("[redeploy] Cleaning previous standalone/static output");
  cleanPreviousBuild();

  console.log("[redeploy] Building production bundle");
  runCommand("pnpm", ["build"]);
  assertStandaloneOutput();

  console.log("[redeploy] Restarting PM2 standalone app");
  startPm2App();

  console.log("[redeploy] Verifying live app and chunk availability");
  await verifyLiveApp();

  console.log("[redeploy] Production cutover complete");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
