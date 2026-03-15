const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const standaloneRoot = path.join(appRoot, ".next", "standalone");
const port = process.env.PORT || "20128";
const warmPaths = [
  "/api/version",
  "/api/settings",
  "/login",
  "/dashboard",
];

function syncDir(sourceRelativePath, targetRelativePath) {
  const sourcePath = path.join(appRoot, sourceRelativePath);
  const targetPath = path.join(standaloneRoot, targetRelativePath);

  if (!fs.existsSync(sourcePath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

syncDir(path.join(".next", "static"), path.join(".next", "static"));
syncDir("public", "public");
syncDir("open-sse", "open-sse");

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

warmStartupRoutes();

require(path.join(standaloneRoot, "server.js"));
