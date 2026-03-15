const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const standaloneRoot = path.join(appRoot, ".next", "standalone");

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

require(path.join(standaloneRoot, "server.js"));
