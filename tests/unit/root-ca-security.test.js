import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const forge = require("node-forge");
const source = fs.readFileSync(new URL("../../src/mitm/cert/rootCA.js", import.meta.url), "utf8");
let temporary;
let directory;
let api;

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "orca-root-ca-"));
  directory = path.join(temporary, "mitm");
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, process, console,
    require: name => name === "../paths" ? { MITM_DIR: directory } : require(name),
  });
  api = module.exports;
});
afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

describe("Root CA file boundaries", () => {
  it("creates a usable private pair and preserves it on repeated generation", async () => {
    await api.generateRootCA();
    const first = fs.readFileSync(api.ROOT_CA_KEY_PATH, "utf8");
    if (process.platform !== "win32") fs.chmodSync(api.ROOT_CA_KEY_PATH, 0o644);
    expect(api.loadRootCA().cert.verify(api.loadRootCA().cert)).toBe(true);
    await api.generateRootCA();
    expect(fs.readFileSync(api.ROOT_CA_KEY_PATH, "utf8")).toBe(first);
    if (process.platform !== "win32") {
      expect(fs.statSync(api.ROOT_CA_KEY_PATH).mode & 0o777).toBe(0o600);
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    }
    const leaf = forge.pki.certificateFromPem(api.generateLeafCert("example.test", api.loadRootCA()).cert);
    expect(leaf.serialNumber).toMatch(/^01[0-9a-f]{30}$/);
    expect(api.loadRootCA().cert.verify(leaf)).toBe(true);
  });

  it("does not overwrite an incomplete pair", async () => {
    fs.mkdirSync(directory);
    fs.writeFileSync(api.ROOT_CA_KEY_PATH, "existing key");
    await expect(api.generateRootCA()).rejects.toThrow();
    expect(fs.readFileSync(api.ROOT_CA_KEY_PATH, "utf8")).toBe("existing key");
    expect(fs.existsSync(api.ROOT_CA_CERT_PATH)).toBe(false);
  });

  it.each(["rootCA.key", "rootCA.crt"])("rejects a %s symlink without changing its target", async name => {
    fs.mkdirSync(directory);
    const target = path.join(temporary, "outside");
    fs.writeFileSync(target, "keep me");
    fs.symlinkSync(target, path.join(directory, name));
    await expect(api.generateRootCA()).rejects.toThrow();
    expect(() => api.loadRootCA()).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("keep me");
  });

  it("rejects a symlinked CA directory", async () => {
    const target = path.join(temporary, "outside");
    fs.mkdirSync(target);
    fs.symlinkSync(target, directory);
    await expect(api.generateRootCA()).rejects.toThrow();
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it("rejects hardlinked private keys", async () => {
    fs.mkdirSync(directory);
    const target = path.join(temporary, "outside");
    fs.writeFileSync(target, "keep me");
    fs.linkSync(target, api.ROOT_CA_KEY_PATH);
    await expect(api.generateRootCA()).rejects.toThrow();
    expect(() => api.loadRootCA()).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("keep me");
  });

  it("rejects a nonregular private-key file", async () => {
    fs.mkdirSync(directory);
    fs.mkdirSync(api.ROOT_CA_KEY_PATH);
    await expect(api.generateRootCA()).rejects.toThrow();
    expect(() => api.loadRootCA()).toThrow();
  });

  it.skipIf(process.platform === "win32")("rejects directories writable by other users", async () => {
    fs.mkdirSync(directory);
    fs.chmodSync(directory, 0o777);
    await expect(api.generateRootCA()).rejects.toThrow();
    expect(fs.readdirSync(directory)).toEqual([]);
  });
});
