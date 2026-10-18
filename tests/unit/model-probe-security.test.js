import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({ getApiKeys: vi.fn(async () => [{ key: "internal-test-key", isActive: true }]) }));
vi.mock("@/app/api/v1/chat/completions/route.js", () => ({ POST: vi.fn() }));
import { POST as completeChat } from "@/app/api/v1/chat/completions/route.js";
import { POST } from "@/app/api/models/test/route.js";

afterEach(() => vi.restoreAllMocks());

it("never forwards the internal credential to the incoming host", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network must not be used"));
  completeChat.mockResolvedValue(Response.json({ choices: [{ message: { content: "ok" } }] }));
  const result = await POST(new Request("https://attacker.invalid/api/models/test", {
    method: "POST",
    body: JSON.stringify({ model: "test-model" }),
  }));
  expect((await result.json()).ok).toBe(true);
  expect(fetchSpy).not.toHaveBeenCalled();
  const request = completeChat.mock.calls.at(-1)[0];
  expect(request.url).toBe("http://localhost/api/v1/chat/completions");
  expect(request.headers.get("authorization")).toBe("Bearer internal-test-key");
  expect(await request.json()).toMatchObject({ model: "test-model", max_tokens: 1, stream: false });
});

it("preserves local provider error reporting", async () => {
  completeChat.mockResolvedValue(Response.json({ error: { message: "Unavailable model" } }, { status: 404 }));
  const result = await POST(new Request("https://attacker.invalid/api/models/test", {
    method: "POST",
    body: JSON.stringify({ model: "missing" }),
  }));
  expect(await result.json()).toMatchObject({ ok: false, status: 404, error: "HTTP 404: Unavailable model" });
});
