import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  imagePost: vi.fn(),
  chatPost: vi.fn(),
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("open-sse/config/providerModels.js", async (importOriginal) => ({
  ...await importOriginal(),
  PROVIDER_ID_TO_ALIAS: { huggingface: "huggingface" },
  getProviderModels: () => [{ id: "black-forest-labs/FLUX.1-schnell", kind: "image" }],
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  getApiKeys: mocks.getApiKeys,
  getSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/app/api/v1/images/generations/route.js", () => ({ POST: mocks.imagePost }));
vi.mock("@/app/api/v1/chat/completions/route.js", () => ({ POST: mocks.chatPost }));

vi.mock("@/app/api/v1/audio/transcriptions/route.js", () => ({ POST: vi.fn(async () => Response.json({ text: "test" })) }));
vi.mock("@/app/api/v1/embeddings/route.js", () => ({ POST: vi.fn(async () => Response.json({ data: [{ embedding: [0] }] })) }));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const originalFetch = global.fetch;

describe("provider test-models route kind routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imagePost.mockImplementation(async () => Response.json({ data: [{ b64_json: "abc" }] }));
    mocks.chatPost.mockImplementation(async () => Response.json({ choices: [{ message: { content: "ok" } }] }));
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-hf",
      provider: "huggingface",
    });
    mocks.getApiKeys.mockResolvedValue([{ key: "sk-internal", isActive: true }]);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/api/v1/images/generations")) {
        return Promise.resolve(new Response(JSON.stringify({
          created: 1,
          data: [{ b64_json: "abc" }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("routes huggingface image models to /api/v1/images/generations", async () => {
    const { POST } = await import("../../src/app/api/providers/[id]/test-models/route.js");

    const req = new Request("http://localhost/api/providers/conn-hf/test-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: Promise.resolve({ id: "conn-hf" }) });
    const body = await res.json();

    expect(body.provider).toBe("huggingface");
    expect(body.results.some((r) => r.modelId === "black-forest-labs/FLUX.1-schnell" && r.ok)).toBe(true);
    expect(mocks.imagePost).toHaveBeenCalled();
    const imageRequest = mocks.imagePost.mock.calls[0][0];
    expect(new URL(imageRequest.url).pathname).toBe("/api/v1/images/generations");
    expect(imageRequest.method).toBe("POST");
    expect(imageRequest.headers.get("Authorization")).toBe("Bearer sk-internal");
    expect((await imageRequest.json()).model).toContain("FLUX.1-schnell");
  });
});
