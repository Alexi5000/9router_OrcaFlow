import { describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo request-scoped fallback", () => {
  it("falls through when a model returns a request-scoped fallback header", async () => {
    const handleSingleModel = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "Tool schema incompatible" },
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "X-9Router-Request-Scoped-Fallback": "1",
              "X-9Router-Error-Code": "openai_responses_schema_incompatible",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const response = await handleComboChat({
      body: { model: "sonnet", messages: [{ role: "user", content: "hi" }] },
      models: ["codex/gpt-5.4", "claude/claude-sonnet-4-6"],
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(response.status).toBe(200);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });
});
