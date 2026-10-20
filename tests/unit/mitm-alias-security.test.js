import { describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), status: vi.fn(async () => ({ dnsStatus: { antigravity: true, copilot: true } })) }));
vi.mock("@/models", () => ({ getMitmAlias: vi.fn(), setMitmAliasAll: mocks.save }));
vi.mock("@/mitm/manager", () => ({ getMitmStatus: mocks.status }));
import { PUT } from "@/app/api/cli-tools/antigravity-mitm/alias/route.js";

describe("MITM alias validation", () => {
  it.each(["__proto__", "constructor", "unknown"])("rejects unsupported tool %s", async tool => {
    const response = await PUT({ json: async () => ({ tool, mappings: { model: "provider/model" } }) });
    expect(response.status).toBe(400);
  });
  it.each(['{"__proto__":"x"}', '{"constructor":"x"}', '{"prototype":"x"}', '{"model":42}', '[]'])("rejects malformed or prototype mappings %s", async encoded => {
    const response = await PUT({ json: async () => ({ tool: "copilot", mappings: JSON.parse(encoded) }) });
    expect(response.status).toBe(400);
  });
  it("retains normal provider model names", async () => {
    const response = await PUT({ json: async () => ({ tool: "copilot", mappings: { "gpt-4.1": " provider/model ", empty: " " } }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, aliases: { "gpt-4.1": "provider/model" } });
  });
});

 it("preserves inherited-name aliases as own JSON data while retaining DNS gate", async () => {
    mocks.save.mockClear();
    const payload = { tool: "copilot", mappings: { toString: " provider/model ", hasOwnProperty: "provider/other" } };
    const response = await PUT(new Request("http://localhost/api/alias", { method: "PUT", body: JSON.stringify(payload) }));
    expect(response.status).toBe(200);
    const saved = mocks.save.mock.calls[0][1];
    expect(Object.hasOwn(saved, "toString")).toBe(true);
    expect(JSON.parse(JSON.stringify(saved))).toEqual({ toString: "provider/model", hasOwnProperty: "provider/other" });
    mocks.save.mockClear();
    mocks.status.mockResolvedValueOnce({ dnsStatus: { copilot: false } });
    expect((await PUT({ json: async () => payload })).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
