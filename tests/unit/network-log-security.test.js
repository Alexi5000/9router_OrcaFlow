import { describe, it, expect } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

describe("network log record boundaries", () => {
  const hostile = "normal\r\nFORGED\0\x1b[31m";
  for (const [file, marker, context] of [
    ["src/mitm/server.js", "❌ Passthrough error:", { err: { message: hostile } }],
    ["src/mitm/server.js", "❌ MITM error:", { error: { message: hostile } }],
    ["src/mitm/server.js", "Extracted model:", { model: hostile }],
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
});
