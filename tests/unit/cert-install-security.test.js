import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../../src/mitm/cert/install.js", import.meta.url), "utf8");
const malicious = "/tmp/ca ' \" $(touch injected) `whoami`; & %.crt";

function load(platform, fail = () => false, installed = false, nss = false) {
  const calls = [];
  const passwords = [];
  const execFile = vi.fn((file, args, options, callback) => {
    if (typeof options === "function") callback = options;
    calls.push({ file, args, options });
    const stdin = new EventEmitter();
    stdin.end = value => passwords.push(value);
    queueMicrotask(() => {
      const isProbe = (file === "security" && ["verify-cert", "dump-trust-settings"].includes(args[0])) || file === "certutil";
      callback(fail(file, args) || (isProbe && !installed) ? new Error("failed") : null, "");
    });
    return { stdin };
  });
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, Buffer, console: { log() {} }, process: { platform },
    require: name => {
      if (name === "child_process") return { execFile, exec: () => { throw new Error("shell execution forbidden"); } };
      if (name === "../dns/dnsConfig.js") return { execWithPassword: () => { throw new Error("privileged shell execution forbidden"); } };
      if (name === "fs") return { existsSync: value => value === malicious || installed || (nss && value === "/tmp/user/.pki/nssdb"), readFileSync: () => "certificate" };
      if (name === "os") return { homedir: () => "/tmp/user" };
      return require(name);
    },
  });
  return { ...module.exports, calls, passwords };
}

describe("certificate command boundaries", () => {
  it("passes macOS certificate paths as one literal argument to unprivileged and elevated commands", async () => {
    const api = load("darwin");
    await api.installCert("test-password", malicious);
    expect(api.calls[0]).toMatchObject({ file: "security", args: ["verify-cert", "-c", path.resolve(malicious), "-p", "ssl", "-k", "/Library/Keychains/System.keychain"] });
    expect(api.calls.at(-1)).toMatchObject({ file: "sudo", args: ["-S", "--", "security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain", path.resolve(malicious)] });
    expect(api.passwords).toEqual(["test-password\n"]);
  });

  it("passes Linux copy paths literally and refreshes trust", async () => {
    const api = load("linux");
    await api.installCert("password", malicious);
    expect(api.calls.map(call => call.args)).toEqual([
      ["-S", "--", "cp", "--", path.resolve(malicious), "/usr/local/share/ca-certificates/9router-root-ca.crt"],
      ["-S", "--", "update-ca-certificates"],
    ]);
  });

  it("uses the Fedora fallback only after the Debian refresh fails", async () => {
    const api = load("linux", (file, args) => args.includes("update-ca-certificates"));
    await api.installCert("password", malicious);
    expect(api.calls.at(-1).args).toEqual(["-S", "--", "update-ca-trust"]);
  });

  it("rejects failed refresh instead of reporting installation success", async () => {
    const api = load("linux", (file, args) => args.some(arg => arg.startsWith("update-ca-")));
    await expect(api.installCert("password", malicious)).rejects.toThrow("Certificate install failed");
  });

  it("retries refresh for an existing Linux certificate instead of treating a failed prior refresh as trusted", async () => {
    const api = load("linux", (file, args) => args.some(arg => arg.startsWith("update-ca-")), true);
    await expect(api.installCert("password", malicious)).rejects.toThrow();
    expect(api.calls.map(call => call.args)).toEqual([
      ["-S", "--", "update-ca-certificates"],
      ["-S", "--", "update-ca-trust"],
    ]);
  });

  it("does not refresh after copy failure", async () => {
    const api = load("linux", (file, args) => args.includes("cp"));
    await expect(api.installCert("password", malicious)).rejects.toThrow();
    expect(api.calls).toHaveLength(1);
  });

  it("removes the Linux certificate with literal arguments and reports refresh failure", async () => {
    const api = load("linux", (file, args) => args.some(arg => arg.startsWith("update-ca-")), true);
    await expect(api.uninstallCert("password", malicious)).rejects.toThrow("Failed to uninstall certificate");
    expect(api.calls.find(call => call.file === "sudo").args).toEqual(["-S", "--", "rm", "-f", "--", "/usr/local/share/ca-certificates/9router-root-ca.crt"]);
  });

  it("keeps the Windows path out of outer shell parsing and preserves the elevated exit status", async () => {
    const api = load("win32");
    await api.installCert("unused", malicious);
    const call = api.calls.at(-1);
    expect(call.file).toBe("powershell");
    expect(call.options).toEqual({ windowsHide: true });
    const script = call.args.at(-1);
    expect(script).not.toContain(malicious);
    expect(script).toContain("-Wait -PassThru");
    expect(script).toContain("exit $child.ExitCode");
    const encoded = script.match(/'-EncodedCommand','([^']+)'/)[1];
    const inner = Buffer.from(encoded, "base64").toString("utf16le");
    expect(inner).toBe("& certutil '-addstore' 'Root' '" + path.resolve(malicious).replace(/'/g, "''") + "'; exit $LASTEXITCODE");
  });

  it("propagates Windows elevated failure", async () => {
    const api = load("win32", file => file === "powershell");
    await expect(api.installCert("unused", malicious)).rejects.toThrow("Certificate trust-store update failed");
  });

  it("does not reinstall an already trusted certificate", async () => {
    const api = load("darwin", () => false, true);
    await api.installCert("unused", malicious);
    expect(api.calls).toHaveLength(1);
    expect(api.passwords).toEqual([]);
  });
});


it("passes the NSS browser certificate path as a literal argument", async () => {
  const api = load("linux", () => false, false, true);
  await api.installCert("password", malicious);
  expect(api.calls.find(call => call.file === "certutil").args).toEqual(["-d", "sql:/tmp/user/.pki/nssdb", "-A", "-t", "C,,", "-n", "9Router MITM Root CA", "-i", path.resolve(malicious)]);
});

it("runs shared Windows elevation without an outer command shell", async () => {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL("../../src/mitm/winElevated.js", import.meta.url), "utf8"), {
    module, Buffer, process: { platform: "win32" },
    require: () => ({ execFileSync: () => { throw new Error("not admin"); }, execFile: (file, args, options, callback) => { calls.push({ file, args }); callback(null, "ok", ""); } }),
  });
  await module.exports.runElevatedPowerShell("Write-Output 'literal & % PATH'");
  expect(calls[0].file).toBe("powershell");
  expect(calls[0].args.at(-2)).toBe("-Command");
  expect(calls[0].args.at(-1)).toContain("-Wait -PassThru");
  expect(calls[0].args.at(-1)).not.toContain("literal & % PATH");
});
