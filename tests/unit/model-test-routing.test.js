import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), keys: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getApiKeys: mocks.keys }));
vi.mock("@/app/api/v1/embeddings/route.js", () => ({ POST: mocks.dispatch }));
vi.mock("@/app/api/v1/images/generations/route.js", () => ({ POST: mocks.dispatch }));
vi.mock("@/app/api/v1/audio/transcriptions/route.js", () => ({ POST: mocks.dispatch }));
vi.mock("@/app/api/v1/systemone/route.js", () => ({ POST: mocks.dispatch }));
vi.mock("@/app/api/v1/chat/completions/route.js", () => ({ POST: mocks.dispatch }));
import { POST } from "../../src/app/api/models/test/route.js";
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Model probes must stay in process"); }));
  mocks.keys.mockResolvedValue([{ key: "disabled-key", isActive: false }, { key: "active-key", isActive: true }]);
});
afterEach(() => vi.unstubAllGlobals());
async function probe(kind) {
  return POST(new Request("https://attacker.example/api/models/test", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-host": "attacker.example" }, body: JSON.stringify({ model: "test/model", kind }) }));
}
describe("model probes use local handlers", () => {
  it.each([
    ["image", "images/generations", { data: [{ b64_json: "abc" }] }],
    ["embedding", "embeddings", { data: [{ embedding: [0.1, 0.2] }] }],
    ["stt", "audio/transcriptions", { text: "test" }],
    ["llm", "chat/completions", { choices: [{ message: { content: "test" } }] }],
  ])("dispatches %s without forwarding credentials over the network", async (kind, endpoint, body) => {
    mocks.dispatch.mockResolvedValue(response(body));
    expect((await (await probe(kind)).json()).ok).toBe(true);
    const request = mocks.dispatch.mock.calls[0][0];
    expect(request.url).toBe(`http://localhost/api/v1/${endpoint}`);
    expect(request.headers.get("authorization")).toBe("Bearer active-key");
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("rejects a successful HTTP response without embedding data", async () => {
    mocks.dispatch.mockResolvedValue(response({ data: [] }));
    expect((await (await probe("embedding")).json()).ok).toBe(false);
  });
  it("reports a failed internal handler response", async () => {
    mocks.dispatch.mockResolvedValue(response({ error: { message: "denied" } }, 403));
    const result = await (await probe("embedding")).json();
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
