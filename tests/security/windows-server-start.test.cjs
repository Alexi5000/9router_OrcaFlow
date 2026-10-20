const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const source = fs.readFileSync(path.join(__dirname, "../../src/mitm/manager.js"), "utf8");
const start = source.indexOf("function buildWindowsServerScript(");
const end = source.indexOf("\n/**", start);
const scriptSource = source.slice(start, end);

function scriptFor(serverPath, key) {
  return vm.runInNewContext(`${scriptSource}\nbuildWindowsServerScript(key)`, {
    SERVER_PATH: serverPath, key, process: { execPath: process.execPath },
  });
}

test("Windows script rejects paths with native argument delimiters", () => {
  for (const unsafe of ['bad"path', "bad\npath", "bad\rpath", "bad\0path"]) {
    assert.throws(() => scriptFor(unsafe, "key"), /Invalid MITM server path/);
  }
});

test("Windows script retains background launch, inherited environment and the established port probe", () => {
  const script = scriptFor("C:\\app\\server's file.js", "key'; $x = 'literal");
  assert.ok(script.includes("Get-NetTCPConnection -LocalPort 443"));
  assert.ok(script.includes("$env:ROUTER_API_KEY = 'key''; $x = ''literal'"));
  assert.ok(script.includes("-ArgumentList '\"C:\\app\\server''s file.js\"'"));
  assert.ok(!script.includes("Start-Process cmd"));
});

test("actual Windows PowerShell launches Node with literal hostile key/path and inherited environment", { skip: process.platform !== "win32", timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-native-launch-"));
  try {
    const output = path.join(dir, "output.json");
    const marker = path.join(dir, "injected.txt");
    const server = path.join(dir, "server's %ORCA_TEST_EXPAND% & file.cjs");
    fs.writeFileSync(server, `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({ key: process.env.ROUTER_API_KEY, mode: process.env.NODE_ENV, inherited: process.env.ORCA_TEST_EXPAND, script: __filename }));`);
    const key = `fake& echo INJECTED > "${marker}" & rem ' \\ %ORCA_TEST_EXPAND% $variable; \`literal`;
    const prelude = "function Get-NetTCPConnection { return $null }; function Stop-Process { throw 'Unexpected process termination' };\n";
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", prelude + scriptFor(server, key)], {
      env: { ...process.env, ORCA_TEST_EXPAND: "preserved" }, windowsHide: true, timeout: 15000,
    });
    for (let attempts = 0; attempts < 50 && !fs.existsSync(output); attempts++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(fs.existsSync(marker), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), {
      key, mode: "production", inherited: "preserved", script: server,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
