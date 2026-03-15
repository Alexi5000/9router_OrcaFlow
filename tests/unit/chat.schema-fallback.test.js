import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(),
  getComboConfig: vi.fn(),
}));

vi.mock("open-sse/handlers/chatCore.js", () => ({
  handleChatCore: vi.fn(),
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(() => "sk-..."),
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

vi.mock("open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

import { handleChat } from "../../src/sse/handlers/chat.js";
import {
  getProviderCredentials,
  markAccountUnavailable,
  extractApiKey,
} from "../../src/sse/services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getComboConfig, getModelInfo } from "../../src/sse/services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { checkAndRefreshToken } from "../../src/sse/services/tokenRefresh.js";

function makeRequest(model = "sonnet") {
  return new Request("http://localhost:20128/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Ship it." }],
      tools: [
        {
          type: "function",
          function: {
            name: "mcp__pencil__get_style_guide_tags",
            description: "Get style guide tags.",
            parameters: {
              type: "string",
            },
            strict: true,
          },
        },
      ],
    }),
  });
}

describe("chat schema incompatibility fallback", () => {
  beforeEach(() => {
    vi.mocked(getSettings).mockResolvedValue({ requireApiKey: false });
    vi.mocked(extractApiKey).mockReturnValue(null);
    vi.mocked(getComboConfig).mockImplementation(async (model) => {
      if (model === "sonnet") {
        return {
          name: "sonnet",
          models: ["codex/gpt-5.4", "claude/claude-sonnet-4-6"],
        };
      }
      return null;
    });
    vi.mocked(getModelInfo).mockImplementation(async (model) => {
      if (model === "codex/gpt-5.4") {
        return { provider: "codex", model: "gpt-5.4" };
      }
      if (model === "claude/claude-sonnet-4-6") {
        return { provider: "claude", model: "claude-sonnet-4-6" };
      }
      return { provider: null, model: null };
    });
    vi.mocked(getProviderCredentials).mockImplementation(async (provider) => ({
      connectionId: `${provider}-conn-1`,
      providerSpecificData: {},
      _connection: {},
    }));
    vi.mocked(checkAndRefreshToken).mockImplementation(async (_provider, credentials) => credentials);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("falls through to the next combo model without marking the current provider unavailable", async () => {
    vi.mocked(handleChatCore)
      .mockResolvedValueOnce({
        success: false,
        status: 400,
        error: "OpenAI Responses tool schema incompatible: mcp__pencil__get_style_guide_tags",
        errorCode: "openai_responses_schema_incompatible",
        skipProviderCooldown: true,
        requestScopedFallback: true,
        response: new Response(
          JSON.stringify({
            error: {
              message: "OpenAI Responses tool schema incompatible: mcp__pencil__get_style_guide_tags",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        ),
      })
      .mockResolvedValueOnce({
        success: true,
        response: new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      });

    const response = await handleChat(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(handleChatCore).toHaveBeenCalledTimes(2);
    expect(markAccountUnavailable).not.toHaveBeenCalled();
  });
});
