const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const source = fs.readFileSync(path.join(__dirname, "../../src/mitm/manager.js"), "utf8");
const branch = source.indexOf("// Spawn directly — process already has admin rights");
assert.ok(branch >= 0);
const start = source.indexOf("serverProcess = spawn(", branch);
const end = source.indexOf("if (_updateSettings)", start);
assert.ok(start > branch && end > start);
const launchSource = source.slice(start, end);

function launch(serverPath, key, spawnImpl, env) {
  return vm.runInNewContext(`let serverProcess; ${launchSource}; serverProcess`, {
    spawn: spawnImpl, process: { execPath: process.execPath, env }, os,
    effectiveServerPath: serverPath, apiKey: key, mitmRouterBase: "http://localhost:20128",
  });
}

test("Windows launch passes hostile paths and keys literally without a shell", () => {
  const server = "C:\\app\\server's %PATH% & file.js";
  const key = "key'; $x = 'literal&echo injected";
  launch(server, key, (executable, args, options) => {
    assert.equal(executable, process.execPath);
    assert.deepEqual(Array.from(args), [server]);
    assert.equal(options.shell, undefined);
    assert.equal(options.windowsHide, true);
    assert.equal(options.env.ROUTER_API_KEY, key);
    assert.equal(options.env.INHERITED, "preserved");
    assert.equal(options.env.NODE_ENV, "production");
    assert.equal(options.env.MITM_ROUTER_BASE, "http://localhost:20128");
  }, { INHERITED: "preserved" });
});

test("native launch preserves literal hostile key/path and inherited environment", { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-native-launch-"));
  try {
    const output = path.join(dir, "output.json");
    const marker = path.join(dir, "injected.txt");
    const server = path.join(dir, "server's %ORCA_TEST_EXPAND% & file.cjs");
    fs.writeFileSync(server, `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({ key: process.env.ROUTER_API_KEY, mode: process.env.NODE_ENV, inherited: process.env.ORCA_TEST_EXPAND, script: __filename }));`);
    const key = `fake& echo INJECTED > "${marker}" & rem ' %ORCA_TEST_EXPAND% $variable`;
    const child = launch(server, key, spawn, { ...process.env, ORCA_TEST_EXPAND: "preserved" });
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(fs.existsSync(marker), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), {
      key, mode: "production", inherited: "preserved", script: server,
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
