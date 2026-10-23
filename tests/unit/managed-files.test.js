import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import managed from "@/lib/managedFiles";
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "orcaflow-files-")); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const file = () => path.join(root, "config", "credentials.json");
describe("managed file boundary", () => {
  it("creates private files, preserves content and atomically tightens existing files", () => {
    managed.writeFile(file(), "first");
    expect(managed.readFile(file())).toBe("first");
    fs.chmodSync(file(), 0o644);
    managed.writeFile(file(), "second");
    expect(managed.readFile(file())).toBe("second");
    if (process.platform !== "win32") {
      expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file())).mode & 0o777).toBe(0o700);
    }
  });
  it.each(["symlink", "hardlink"])("rejects %s targets for read, write and delete", kind => {
    const outside = path.join(root, "outside");
    fs.writeFileSync(outside, "original");
    fs.mkdirSync(path.dirname(file()));
    if (kind === "symlink") fs.symlinkSync(outside, file());
    else fs.linkSync(outside, file());
    expect(() => managed.readFile(file())).toThrow();
    expect(() => managed.writeFile(file(), "changed")).toThrow();
    expect(() => managed.unlink(file())).toThrow();
    expect(fs.readFileSync(outside, "utf8")).toBe("original");
  });
  it("rejects linked ancestors", () => {
    const outside = path.join(root, "outside"); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.dirname(file()));
    expect(() => managed.writeFile(file(), "secret")).toThrow();
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it.skipIf(process.platform === "win32")("rejects writable ancestor directories", () => {
    fs.mkdirSync(path.dirname(file()), { mode: 0o777 }); fs.chmodSync(path.dirname(file()), 0o777);
    expect(() => managed.writeFile(file(), "secret")).toThrow();
  });
  it.skipIf(process.platform === "win32")("rejects FIFOs without blocking", () => {
    fs.mkdirSync(path.dirname(file())); execFileSync("mkfifo", [file()]);
    expect(() => managed.readFile(file())).toThrow();
    expect(() => managed.writeFile(file(), "secret")).toThrow();
  });
  it("preserves original bytes and removes temporary files after rename failure", () => {
    managed.writeFile(file(), "original");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("disk unavailable"); });
    expect(() => managed.writeFile(file(), "changed")).toThrow("disk unavailable");
    expect(managed.readFile(file())).toBe("original");
    expect(fs.readdirSync(path.dirname(file()))).toEqual(["credentials.json"]);
  });
});
