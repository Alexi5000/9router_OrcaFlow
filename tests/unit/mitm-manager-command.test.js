import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { exec, execFile } from "node:child_process";

const source = fs.readFileSync(new URL("../../src/mitm/manager.js", import.meta.url), "utf8");
const start = source.indexOf("async function killLeftoverMitm(");
const end = source.indexOf("function pollMitmHealth(", start);
const functionSource = source.slice(start, end);
const temporary = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-command-"));
  temporary.push(dir);
  const recorder = path.join(dir, "record.cjs");
  const record = path.join(dir, "args.json");
  const marker = path.join(dir, "injected");
  fs.writeFileSync(recorder, `require('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2))); process.stdin.resume(); process.stdin.on('end', () => process.exit(1));`);
  return { dir, recorder, record, marker };
}

async function cleanup(f, serverPath, password, isWindows = false) {
  const calls = [];
  const writes = [];
  const pending = [];
  const shell = command => command.replace(/^pkill/, `'${process.execPath}' '${f.recorder}'`);
  const run = (command, callback) => {
    let child;
    pending.push(new Promise(resolve => {
      child = exec(shell(command), (...args) => { callback(...args); resolve(); });
      child.stdin.end();
    }));
    return child;
  };
  const promise = vm.runInNewContext(`${functionSource}\nkillLeftoverMitm(password)`, {
    isSudoAvailable: () => false, password, IS_WIN: isWindows, SERVER_PATH: serverPath, PID_FILE: "/missing-pid",
    serverProcess: null, serverPid: null, fs: { existsSync: () => false },
    setTimeout: callback => queueMicrotask(callback),
    exec: run,
    execFile: (file, args, callback) => {
      calls.push({ file, args: [...args] });
      const child = execFile(process.execPath, [f.recorder, ...args], callback);
      if (file !== "sudo") child.stdin.end();
      else {
        const original = child.stdin.end.bind(child.stdin);
        child.stdin.end = value => { writes.push(value); return original(value); };
      }
      return child;
    },
    require: () => ({ execWithPassword: command => new Promise(resolve => run(command, resolve)) }),
  });
  await promise;
  await Promise.all(pending);
  return { calls, writes };
}

describe("MITM cleanup subprocess boundaries", () => {
  it.each([null, "test-password"])("never evaluates dollar substitutions with password %s", async password => {
    const f = fixture();
    const serverPath = `/app/$(/usr/bin/touch ${f.marker})/server.js`;
    const result = await cleanup(f, serverPath, password);
    expect(fs.existsSync(f.marker)).toBe(false);
    const args = JSON.parse(fs.readFileSync(f.record, "utf8"));
    expect(args.slice(-4, -1)).toEqual(["-SIGKILL", "-f", "--"]);
    expect(args.at(-1)).toBe(serverPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    expect(result.calls[0].file).toBe(password ? "sudo" : "pkill");
    expect(result.writes).toEqual(password ? [password + "\n"] : []);
  });

  it.each([null, "test-password"])("preserves hostile path text as one literal pattern with password %s", async password => {
    const f = fixture();
    const serverPath = "-leading option/'quote\";`backtick`[group].*/server.js";
    const result = await cleanup(f, serverPath, password);
    const args = JSON.parse(fs.readFileSync(f.record, "utf8"));
    expect(args.at(-2)).toBe("--");
    expect(new RegExp(args.at(-1)).test(serverPath)).toBe(true);
    expect(new RegExp(args.at(-1)).test("unrelated/serverXjs")).toBe(false);
    expect(result.calls).toHaveLength(1);
  });

  it("does not run Unix path cleanup on Windows", async () => {
    const f = fixture();
    const result = await cleanup(f, "/app/server.js", null, true);
    expect(result.calls).toEqual([]);
    expect(fs.existsSync(f.record)).toBe(false);
  });
});
