import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";

const source = fs.readFileSync(new URL("../../src/mitm/manager.js", import.meta.url), "utf8");
const start = source.indexOf("async function startServer(");
const end = source.indexOf("\n/**", start);
const functionSource = source.slice(start, end);
const temporary = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

async function launch(apiKeyFor, hostilePath = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-start-"));
  temporary.push(dir);
  const marker = path.join(dir, "injected");
  const record = path.join(dir, "env.json");
  const serverPath = path.join(dir, hostilePath ? "server's $literal; file.cjs" : "server.cjs");
  fs.writeFileSync(serverPath, `require('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ key: process.env.ROUTER_API_KEY, mode: process.env.NODE_ENV, inherited: process.env.ORCA_TEST_SETTING })); process.stdin.resume();`);
  const apiKey = apiKeyFor(marker);
  let childDone;
  let invocation;
  const writes = [];
  const result = await vm.runInNewContext(`${functionSource}\nstartServer(apiKey, "test-password")`, {
    apiKey, IS_WIN: false, serverProcess: null, serverPid: null, PID_FILE: "/unused/pid", MITM_DIR: "/unused/mitm", MITM_PORT: 443,
    SERVER_PATH: serverPath, process: { execPath: process.execPath, env: { ...process.env, ORCA_TEST_SETTING: "preserved" } }, path,
    fs: { existsSync: file => !file.endsWith("pid"), writeFileSync() {}, unlinkSync() {} },
    console: { log() {}, error() {} },
    killLeftoverMitm: async () => {}, checkPort443Free: async () => "free",
    require: () => ({ checkCertInstalled: async () => true }),
    spawn: (file, args, options) => {
      invocation = { file, args: [...args], options };
      const child = args.includes("sh")
        ? spawn("sh", ["-c", args.at(-1)], options)
        : spawn(args[3], args.slice(4), options);
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = value => { writes.push(value); return write(value); };
      childDone = new Promise(resolve => child.on("close", resolve));
      return child;
    },
    pollMitmHealth: async () => { await childDone; return { ok: true, pid: 123 }; },
    saveMitmSettings: async () => {}, setCachedPassword() {},
  });
  return { apiKey, marker, record, serverPath, invocation, writes, result };
}

describe("POSIX MITM server startup command boundaries", () => {
  it("passes an injection-shaped credential literally through the environment", async () => {
    const f = await launch(marker => `'; /usr/bin/touch ${marker}; #`);
    expect(fs.existsSync(f.marker)).toBe(false);
    expect(JSON.parse(fs.readFileSync(f.record, "utf8"))).toEqual({ key: f.apiKey, mode: "production", inherited: "preserved" });
    expect(f.invocation.file).toBe("sudo");
    expect(f.invocation.args).toEqual(["-S", "-E", "--", process.execPath, f.serverPath]);
    expect(f.writes).toEqual(["test-password\n"]);
  });

  it("starts a path with apostrophes, dollar signs, spaces, and semicolons without shell parsing", async () => {
    const f = await launch(() => "normal-key", true);
    expect(JSON.parse(fs.readFileSync(f.record, "utf8")).key).toBe("normal-key");
    expect(f.invocation.args.at(-1)).toBe(f.serverPath);
  });

  it("preserves ordinary credentials and existing process options", async () => {
    const f = await launch(() => "sk-normal-key");
    expect(JSON.parse(fs.readFileSync(f.record, "utf8")).key).toBe("sk-normal-key");
    expect(f.invocation.options.detached).toBe(false);
    expect(f.invocation.options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(f.result.running).toBe(true);
  });
});
