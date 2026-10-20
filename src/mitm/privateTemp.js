const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

async function withPrivateTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orcaflow-elevate-"));
  try {
    if (process.platform === "win32") {
      const identity = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
      const sid = identity.match(/S-1-5-(?:\d+-)*\d+/)?.[0];
      if (!sid) throw new Error("Cannot identify the current Windows account");
      execFileSync("icacls.exe", [directory, "/inheritance:r", "/grant:r",
        `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"],
      { windowsHide: true, stdio: "pipe" });
    } else {
      fs.chmodSync(directory, 0o700);
    }
    const filePath = (name) => {
      if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(name)) throw new Error("Invalid temporary filename");
      return path.join(directory, name);
    };
    return await callback({
      write(name, content) {
        const target = filePath(name);
        fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
        return target;
      },
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { withPrivateTempDirectory };
