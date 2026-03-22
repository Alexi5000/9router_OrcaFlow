const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawnSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const standaloneRoot = path.join(appRoot, ".next", "standalone");
const standaloneServerPath = path.join(standaloneRoot, "server.js");
const buildStatePath = path.join(appRoot, ".next", "standalone-autobuild-state.json");
const port = process.env.PORT || "20128";
const host = process.env.HOSTNAME || "0.0.0.0";
const autoBuildEnabled = process.env.STANDALONE_AUTOBUILD !== "false";
const autoBuildCooldownMs = Number(process.env.STANDALONE_AUTOBUILD_COOLDOWN_MS || 5 * 60 * 1000);
const healthcheckEnabled = process.env.STANDALONE_HEALTHCHECK !== "false";
const startupHealthTimeoutMs = Number(process.env.STANDALONE_HEALTHCHECK_TIMEOUT_MS || 30_000);
const startupHealthIntervalMs = Number(process.env.STANDALONE_HEALTHCHECK_INTERVAL_MS || 1_500);
const requiredEnvVars = ["JWT_SECRET", "INITIAL_PASSWORD", "DATA_DIR"];
const warmPaths = [
  "/api/version",
  "/api/settings",
  "/login",
  "/dashboard",
];

function getPackageManagerCommand(command) {
  if (process.platform === "win32") {
    return `${command}.cmd`;
  }

  return command;
}

function validateRequiredEnv() {
  const missing = requiredEnvVars.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`[standalone] Missing required environment variable(s): ${missing.join(", ")}`);
  }
}

function assertPortAvailable() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      server.close();
      reject(new Error(`[standalone] Port ${port} on ${host} is unavailable: ${error.message}`));
    });

    server.once("listening", () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve();
      });
    });

    server.listen({ host, port: Number(port), exclusive: true });
  });
}

function readBuildState() {
  if (!fs.existsSync(buildStatePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(buildStatePath, "utf8"));
  } catch {
    return null;
  }
}

function writeBuildState(state) {
  fs.mkdirSync(path.dirname(buildStatePath), { recursive: true });
  fs.writeFileSync(buildStatePath, JSON.stringify(state, null, 2));
}

function clearBuildState() {
  if (fs.existsSync(buildStatePath)) {
    fs.rmSync(buildStatePath, { force: true });
  }
}

function getBuildCommand() {
  if (process.platform === "win32") {
    return {
      command: getPackageManagerCommand("npx"),
      args: ["next", "build", "--webpack"],
      display: "npx next build --webpack",
    };
  }

  if (fs.existsSync(path.join(appRoot, "package-lock.json"))) {
    return {
      command: getPackageManagerCommand("npm"),
      args: ["run", "build"],
      display: "npm run build",
    };
  }

  if (fs.existsSync(path.join(appRoot, "pnpm-lock.yaml"))) {
    return {
      command: getPackageManagerCommand("pnpm"),
      args: ["exec", "next", "build", "--webpack"],
      display: "pnpm exec next build --webpack",
    };
  }

  return {
    command: getPackageManagerCommand("npx"),
    args: ["next", "build", "--webpack"],
    display: "npx next build --webpack",
  };
}

function runProductionBuild() {
  const build = getBuildCommand();
  console.warn(`[standalone] Attempting to rebuild standalone bundle with: ${build.display}`);

  const result = spawnSync(build.command, build.args, {
    cwd: appRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
  });

  if (result.status !== 0) {
    writeBuildState({
      failedAt: Date.now(),
      command: build.display,
      exitCode: result.status,
    });
    throw new Error(`[standalone] Automatic production rebuild failed with exit code ${result.status}`);
  }

  clearBuildState();
}

function syncDir(sourceRelativePath, targetRelativePath) {
  const sourcePath = path.join(appRoot, sourceRelativePath);
  const targetPath = path.join(standaloneRoot, targetRelativePath);

  if (!fs.existsSync(sourcePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.mkdirSync(targetPath, { recursive: true });
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
}

function assertPathExists(targetPath, message) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(message);
  }
}

function assertDirHasFiles(targetPath, message) {
  assertPathExists(targetPath, message);
  const entries = fs.readdirSync(targetPath);
  if (!entries.length) {
    throw new Error(message);
  }
}

function validateStandaloneBundle() {
  assertPathExists(
    standaloneServerPath,
    `[standalone] Missing standalone server bundle at ${standaloneServerPath}`
  );
  assertDirHasFiles(
    path.join(appRoot, ".next", "static"),
    `[standalone] Missing build static assets at ${path.join(appRoot, ".next", "static")}`
  );
}

function ensureStandaloneBundle() {
  try {
    validateStandaloneBundle();
    clearBuildState();
    return;
  } catch (error) {
    if (!autoBuildEnabled) {
      throw error;
    }

    const lastBuildState = readBuildState();
    if (lastBuildState?.failedAt && Date.now() - lastBuildState.failedAt < autoBuildCooldownMs) {
      const retryInMs = autoBuildCooldownMs - (Date.now() - lastBuildState.failedAt);
      throw new Error(
        `${error.message}\n[standalone] Skipping automatic rebuild because the previous rebuild failed recently. Retry in ${Math.ceil(
          retryInMs / 1000
        )}s or delete ${buildStatePath}.`
      );
    }

    console.warn(`${error.message}\n[standalone] Bundle missing or incomplete. Rebuilding in-place before startup.`);
    runProductionBuild();
    validateStandaloneBundle();
  }
}

function validateRuntimeAssets() {
  assertDirHasFiles(
    path.join(standaloneRoot, ".next", "static"),
    `[standalone] Runtime static assets were not copied to ${path.join(standaloneRoot, ".next", "static")}`
  );
}

function warmRoute(pathname) {
  const url = `http://127.0.0.1:${port}${pathname}`;
  return fetch(url, {
    headers: {
      "User-Agent": "orcaflow-startup-warmer",
      Accept: "text/html,application/json",
    },
  }).catch((error) => {
    console.warn(`[startup-warm] ${pathname} failed: ${error.message}`);
  });
}

function warmStartupRoutes() {
  setTimeout(() => {
    Promise.allSettled(warmPaths.map(warmRoute)).then((results) => {
      const okCount = results.filter((result) => result.status === "fulfilled").length;
      console.log(`[startup-warm] Warmed ${okCount}/${warmPaths.length} routes on port ${port}`);
    });
  }, 1500);
}

async function isHealthyRoute(pathname, expectedStatus) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    redirect: "manual",
    headers: {
      "User-Agent": "orcaflow-startup-healthcheck",
      Accept: "text/html,application/json",
    },
  });

  return response.status === expectedStatus;
}

async function waitForStartupHealth() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < startupHealthTimeoutMs) {
    try {
      const versionOk = await isHealthyRoute("/api/version", 200);
      const loginOk = await isHealthyRoute("/login", 200);

      if (versionOk && loginOk) {
        console.log(`[startup-health] Router became healthy on http://127.0.0.1:${port}`);
        return;
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, startupHealthIntervalMs));
  }

  throw new Error(
    `[startup-health] Timed out waiting ${startupHealthTimeoutMs}ms for /api/version and /login to become healthy on port ${port}`
  );
}

function runStartupHealthGate() {
  if (!healthcheckEnabled) {
    return;
  }

  setTimeout(() => {
    waitForStartupHealth().catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  }, 250);
}

async function main() {
  validateRequiredEnv();
  await assertPortAvailable();
  ensureStandaloneBundle();
  syncDir(path.join(".next", "static"), path.join(".next", "static"));
  syncDir("public", "public");
  syncDir("open-sse", "open-sse");
  validateRuntimeAssets();
  warmStartupRoutes();
  runStartupHealthGate();
  require(standaloneServerPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
