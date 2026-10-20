import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

describe.each(["test-claude46.js", "test-kilocode.js"])("%s credentials", (filename) => {
  const source = readFileSync(resolve(import.meta.dirname, "../../scripts", filename), "utf8");

  it.each([undefined, "", "   "])("fails before network access without a configured token", (token) => {
    let calls = 0;
    const logs = [];
    expect(() => runInNewContext(source, {
      process: {
        env: { KILO_API_TOKEN: token },
        exit: (code) => { throw new Error("exit:" + code); },
      },
      console: { error: (...args) => logs.push(args.join(" ")), log: () => {} },
      fetch: () => { calls++; throw new Error("network forbidden"); },
    })).toThrow("exit:1");
    expect(calls).toBe(0);
    expect(logs.join(" ")).toContain("KILO_API_TOKEN is required");
  });

  it("uses only the configured token for provider requests", async () => {
    const headers = [];
    const logs = [];
    await runInNewContext(source, {
      process: { env: { KILO_API_TOKEN: " synthetic-test-token " } },
      console: {
        error: (...args) => logs.push(args.join(" ")),
        log: (...args) => logs.push(args.join(" ")),
      },
      fetch: async (_url, options) => {
        headers.push(options.headers.Authorization);
        return { json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
      },
    });
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((value) => value === "Bearer synthetic-test-token")).toBe(true);
    expect(logs.join(" ")).not.toContain("synthetic-test-token");
  });
});
