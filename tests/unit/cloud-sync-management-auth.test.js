import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:sockets", () => ({ connect: () => { throw new Error("Network forbidden in sync tests"); } }));
import worker from "../../cloud/src/index.js";
const secret = "dummy-management-token-with-at-least-32-characters";
let records, env, sequence = 0;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in sync tests"); }));
  records = new Map();
  env = { CLOUD_SYNC_MANAGEMENT_TOKEN: secret, DB: { prepare: vi.fn(sql => ({ bind: (...args) => ({
    first: async () => records.has(args[0]) ? { data: JSON.stringify(records.get(args[0])) } : null,
    run: async () => {
      if (sql.trim().startsWith("INSERT")) records.set(args[0], JSON.parse(args[1]));
      else if (sql.trim().startsWith("DELETE")) records.delete(args[0]);
      else throw new Error("Unexpected SQL");
    }
  }) })) } };
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const request = (machine, method, token, body) => new Request(`https://example.invalid/sync/${machine}`, {
  method, headers: { ...(token ? { authorization: token } : {}), "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const fetch = req => worker.fetch(req, env, {});
describe("standalone cloud sync management authorization", () => {
  it.each(["GET", "POST", "DELETE"])("denies anonymous and inference credentials for %s before storage access", async method => {
    for (const token of [undefined, "Bearer dummy-machine", "Bearer sk-inference-key", `Basic ${secret}`, `Bearer ${secret}extra`]) {
      const response = await fetch(request("dummy-machine", method, token));
      expect(response.status).toBe(401);
      expect(env.DB.prepare).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain(secret);
    }
  });
  it.each(["GET", "POST", "DELETE"])("fails closed when the Worker secret is missing or short for %s", async method => {
    for (const value of [undefined, "", "too-short"]) {
      env.CLOUD_SYNC_MANAGEMENT_TOKEN = value;
      expect((await fetch(request("dummy-machine", method, `Bearer ${secret}`))).status).toBe(503);
      expect(env.DB.prepare).not.toHaveBeenCalled();
    }
  });
  it("preserves authorized create, read, update and delete payloads", async () => {
    const machine = `authorized-dummy-${sequence++}`;
    const body = { providers: [{ id: "dummy-provider", accessToken: "DUMMY-NOT-A-CREDENTIAL" }], apiKeys: ["dummy-inference"] };
    const post = await fetch(request(machine, "POST", `Bearer ${secret}`, body));
    expect(post.status).toBe(200);
    expect((await post.json()).data.providers["dummy-provider"].accessToken).toBe("DUMMY-NOT-A-CREDENTIAL");
    const get = await fetch(request(machine, "GET", `Bearer ${secret}`));
    expect(get.status).toBe(200);
    expect((await get.json()).data.apiKeys).toEqual(["dummy-inference"]);
    expect((await fetch(request(machine, "POST", `Bearer ${secret}`, { providers: [] }))).status).toBe(200);
    expect(records.get(machine).providers).toEqual({});
    expect((await fetch(request(machine, "DELETE", `Bearer ${secret}`))).status).toBe(200);
    expect(records.has(machine)).toBe(false);
    expect((await fetch(request(machine, "GET", `Bearer ${secret}`))).status).toBe(404);
  });
  it("invalidates old authorization on secret rotation, including cached records", async () => {
    const machine = `rotation-dummy-${sequence++}`;
    await fetch(request(machine, "POST", `Bearer ${secret}`, { providers: [] }));
    env.CLOUD_SYNC_MANAGEMENT_TOKEN = "replacement-management-token-with-at-least-32-characters";
    env.DB.prepare.mockClear();
    expect((await fetch(request(machine, "GET", `Bearer ${secret}`))).status).toBe(401);
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect((await fetch(request(machine, "GET", `Bearer ${env.CLOUD_SYNC_MANAGEMENT_TOKEN}`))).status).toBe(200);
  });
  it("returns not-found for the obsolete missing-handler provider test route", async () => {
    expect((await fetch(new Request("https://example.invalid/testClaude", { method: "POST" }))).status).toBe(404);
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });
  it("preserves credential-free preflight without reading storage", async () => {
    delete env.CLOUD_SYNC_MANAGEMENT_TOKEN;
    expect((await fetch(request("dummy-machine", "OPTIONS"))).status).toBe(200);
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });
});
