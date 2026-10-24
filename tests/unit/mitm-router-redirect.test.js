import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

it("rejects redirects before forwarding the configured router credential", async () => {
  const fetch = vi.fn(async (_url, options) => {
    if (options.redirect === "error") throw new TypeError("redirect rejected");
    return { ok: true };
  });
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL("../../src/mitm/handlers/base.js", import.meta.url), "utf8"), {
    module, fetch, process: { env: { ROUTER_API_KEY: "fixture-secret" } },
    require: () => ({ log() {}, err() {} }),
  });
  await expect(module.exports.fetchRouter({ model: "test" })).rejects.toThrow("redirect rejected");
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith("http://localhost:20128/v1/chat/completions", expect.objectContaining({ redirect: "error", headers: expect.objectContaining({ Authorization: "Bearer fixture-secret" }) }));
});
