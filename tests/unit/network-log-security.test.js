import { describe, it, expect } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

describe("network log record boundaries", () => {
  const hostile = "normal\r\nFORGED\0\x1b[31m";
  for (const [file, marker, context] of [
    ["src/lib/tunnel/tunnelManager.js", "[Tunnel] Reconnect attempt", { attempt: 2, err: { message: hostile } }],
  ]) {
    it("escapes remote values at " + marker, () => {
      const source = fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8");
      const lines = source.split("\n").filter(line => line.includes(marker) && line.includes("console."));
      expect(lines.length).toBeGreaterThan(0);
      const records = [];
      for (const line of lines) {
        vm.runInNewContext(line, { ...context, console: { log: (...args) => records.push(args), error: (...args) => records.push(args) } });
      }
      for (const args of records) {
        expect(args.join(" ")).not.toMatch(/[\r\n\0\x1b]/);
        expect(JSON.parse(args.at(-1))).toBe(hostile);
      }
    });
  }

  it("escapes all MITM log and error messages through the shared logger", () => {
    const source = fs.readFileSync(new URL("../../src/mitm/logger.js", import.meta.url), "utf8");
    const records = [];
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module,
      require: (name) => {
        if (name === "fs") return { existsSync: () => true };
        if (name === "path") return { join: (...parts) => parts.join("/") };
        if (name === "./paths") return { DATA_DIR: "/fixture" };
        if (name === "./config") return { LOG_BLACKLIST_URL_PARTS: [] };
        if (name === "zlib") return {};
        if (name === "node:crypto") return { randomUUID: () => "fixture-id" };
        if (name.endsWith("/managedFiles.js")) return {};
        throw new Error(`Unexpected import ${name}`);
      },
      console: { log: (line) => records.push(line), error: (line) => records.push(line) },
    });
    module.exports.log(hostile);
    module.exports.err(hostile);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record).not.toMatch(/[\r\n\0\x1b]/);
      expect(JSON.parse(record.slice(record.indexOf("[MITM] ") + 7))).toBe(hostile);
    }
  });
});
