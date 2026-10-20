import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../../scripts/recover-usage-from-outlog.cjs", import.meta.url), "utf8");
const script = source.slice(0, source.lastIndexOf("recover().catch"));
let root;
let usage;
let backup;
let safety;
const record = { timestamp: "2026-01-01T00:00:00Z", provider: "openai", model: "test", tokens: { input_tokens: 1 } };
const initial = JSON.stringify({ history: [record], original: true });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "orca-usage-recovery-"));
  usage = path.join(root, "usage.json");
  backup = path.join(root, "usage.json.backup-pre-scrub");
  safety = path.join(root, "backups");
  fs.writeFileSync(usage, initial);
  fs.writeFileSync(backup, JSON.stringify({ history: [{ ...record, timestamp: "2025-12-01T00:00:00Z" }], older: true }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

async function run(overrides = {}) {
  const reports = [];
  const context = {
    require: name => name === "fs" ? { ...fs, ...overrides } : require(name),
    process: { ...process, env: { DATA_DIR: root, USERPROFILE: root, NINEROUTER_BACKUP_DIR: safety } },
    __dirname: root,
    Buffer,
    console: { log: text => reports.push(JSON.parse(text)) },
  };
  await vm.runInNewContext(`${script}\nrecover();`, context);
  return reports[0];
}

it("merges histories and keeps the exact original snapshot in an owner-only backup", async () => {
  const report = await run();
  const restored = JSON.parse(fs.readFileSync(usage, "utf8"));
  expect(restored.history).toHaveLength(2);
  expect(restored.original).toBe(true);
  expect(restored.older).toBe(true);
  expect(fs.readFileSync(report.safetyPath, "utf8")).toBe(initial);
  if (process.platform !== "win32") {
    expect(fs.statSync(report.safetyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(report.safetyPath)).mode & 0o777).toBe(0o700);
  }
});

it.each(["symlink", "hardlink"])("rejects %s usage files without modifying their target", async kind => {
  const outside = path.join(root, "outside");
  fs.renameSync(usage, outside);
  if (kind === "symlink") fs.symlinkSync(outside, usage);
  else fs.linkSync(outside, usage);
  await expect(run()).rejects.toThrow();
  expect(fs.readFileSync(outside, "utf8")).toBe(initial);
});

it("replacement during backup cannot redirect the recovery write", async () => {
  const original = path.join(root, "original");
  const outside = path.join(root, "outside");
  fs.writeFileSync(outside, "never modify this target");
  let swapped = false;
  function swap() {
    if (swapped) return;
    swapped = true;
    fs.renameSync(usage, original);
    fs.symlinkSync(outside, usage);
  }
  const report = await run({
    mkdtempSync(prefix) { const result = fs.mkdtempSync(prefix); swap(); return result; },
    copyFileSync(from, to) { fs.copyFileSync(from, to); swap(); },
  });
  expect(fs.readFileSync(outside, "utf8")).toBe("never modify this target");
  expect(JSON.parse(fs.readFileSync(original, "utf8")).history).toHaveLength(2);
  expect(fs.readFileSync(report.safetyPath, "utf8")).toBe(initial);
});

it("handles partial writes at explicit offsets and preserves valid JSON", async () => {
  const report = await run({
    writeSync(fd, buffer, offset, length, position) {
      return fs.writeSync(fd, buffer, offset, Math.min(length, 7), position);
    },
  });
  expect(JSON.parse(fs.readFileSync(usage, "utf8")).history).toHaveLength(2);
  expect(report.merged.total).toBe(2);
});

it("stalled writes reject and retain the safety snapshot without truncating", async () => {
  await expect(run({ writeSync() { return 0; } })).rejects.toThrow("no progress");
  expect(fs.readFileSync(usage, "utf8")).toBe(initial);
  const privateDir = fs.readdirSync(safety)[0];
  expect(fs.readFileSync(path.join(safety, privateDir, "usage.json"), "utf8")).toBe(initial);
});

it("the CLI reports a durable backup and restored usage on disk", () => {
  const result = execFileSync(process.execPath, [fileURLToPath(new URL("../../scripts/recover-usage-from-outlog.cjs", import.meta.url))], {
    env: { ...process.env, DATA_DIR: root, USERPROFILE: root, NINEROUTER_BACKUP_DIR: safety },
    encoding: "utf8",
    timeout: 5000,
  });
  const report = JSON.parse(result);
  expect(report.merged.total).toBe(2);
  expect(fs.readFileSync(report.safetyPath, "utf8")).toBe(initial);
  expect(JSON.parse(fs.readFileSync(usage, "utf8")).history).toHaveLength(2);
});

it.skipIf(process.platform === "win32")("refuses an unsafe backup directory before changing usage", async () => {
  fs.mkdirSync(safety, { mode: 0o777 });
  fs.chmodSync(safety, 0o777);
  await expect(run()).rejects.toThrow("owned and protected");
  expect(fs.readFileSync(usage, "utf8")).toBe(initial);
});
