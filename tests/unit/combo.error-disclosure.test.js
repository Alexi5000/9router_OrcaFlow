import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo exception disclosure", () => {
  it.each([
    new Error("credential-canary /private/config.json"),
    "credential-canary",
    null,
    { toString() { throw new Error("credential-canary"); } },
  ])("returns a safe response when a provider throws", async (failure) => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const response = await handleComboChat({
      body: {}, models: ["provider/model"], log,
      handleSingleModel: async () => { throw failure; },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { message: "Model request failed" } });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("credential-canary");
  });

  it("continues to a healthy provider after an exception", async () => {
    const success = new Response("healthy", { status: 200 });
    const handleSingleModel = vi.fn()
      .mockRejectedValueOnce(new Error("credential-canary"))
      .mockResolvedValueOnce(success);
    const log = { info: vi.fn(), warn: vi.fn() };
    const response = await handleComboChat({
      body: {}, models: ["first/model", "second/model"], log, handleSingleModel,
    });
    expect(response).toBe(success);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("credential-canary");
  });
});
