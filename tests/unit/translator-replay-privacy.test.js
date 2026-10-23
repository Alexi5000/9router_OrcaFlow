import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../../tester/translator/testFromFile.js", import.meta.url), "utf8");
describe("operator fixture replay", () => {
  it("sends the selected fixture but redacts request metadata and refuses redirects", async () => {
    const output = [];
    const payload = { url: "https://provider.test/api?token=url-secret", headers: { Authorization: "short-secret", Cookie: "cookie-secret", "x-custom": "custom-secret" }, body: { model: "test", messages: [] } };
    const fetch = vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", headers: new Headers(), json: async () => ({ result: "ok" }) }));
    const result = vm.runInNewContext(source, {
      require: name => name === "fs" ? { existsSync: () => true, readFileSync: () => JSON.stringify(payload) } : path,
      process: { argv: ["node", "testFromFile.js", "chosen.json"], cwd: () => "/tmp", env: {}, stdout: { write: text => output.push(text) }, exit: code => { throw new Error(`exit ${code}`); } },
      console: { log: (...args) => output.push(args.join(" ")), error: (...args) => output.push(args.join(" ")) }, fetch, URL,
    });
    await result;
    expect(fetch).toHaveBeenCalledWith(payload.url, expect.objectContaining({ headers: payload.headers, body: JSON.stringify(payload.body), redirect: "error" }));
    for (const secret of ["url-secret", "short-secret", "cookie-secret", "custom-secret"]) expect(output.join("\n")).not.toContain(secret);
  });
});
