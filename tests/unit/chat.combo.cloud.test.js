import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: vi.fn(),
}));

vi.mock("../../cloud/src/utils/logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../cloud/src/utils/apiKey.js", () => ({
  parseApiKey: vi.fn(),
  extractBearerToken: vi.fn(),
}));

vi.mock("../../cloud/src/services/storage.js", () => ({
  getMachineData: vi.fn(),
  saveMachineData: vi.fn(),
}));

vi.mock("../../cloud/src/services/tokenRefresh.js", () => ({
  refreshTokenByProvider: vi.fn(),
}));

import { handleChat } from "../../cloud/src/handlers/chat.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { parseApiKey, extractBearerToken } from "../../cloud/src/utils/apiKey.js";
import { getMachineData, saveMachineData } from "../../cloud/src/services/storage.js";

const API_KEY = "sk-mach01-key01-ab12cd34";

function makeMachineData() {
  return {
    apiKeys: [{ key: API_KEY }],
    modelAliases: {
      "claude-sonnet-4-6": "combo/sonnet",
    },
    combos: [
      {
        name: "sonnet",
        models: ["github/gpt-4.1"],
      },
    ],
    providers: {
      "conn-001": {
        provider: "github",
        accessToken: "github-token",
        isActive: true,
        priority: 1,
        providerSpecificData: {},
      },
    },
  };
}

function makeRequest(model) {
  return new Request("https://9cli.hxd.app/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
}

describe("cloud chat combo routing", () => {
  beforeEach(() => {
    vi.mocked(extractBearerToken).mockReturnValue(API_KEY);
    vi.mocked(parseApiKey).mockResolvedValue({
      machineId: "mach01",
      keyId: "key01",
      isNewFormat: true,
    });
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
    vi.mocked(saveMachineData).mockResolvedValue();
    vi.mocked(handleChatCore).mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("routes aliases that resolve to combo/name through the combo chain", async () => {
    const response = await handleChat(makeRequest("claude-sonnet-4-6"), {}, {});

    expect(response.status).toBe(200);
    expect(handleChatCore).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleChatCore).mock.calls[0][0].modelInfo).toEqual({
      provider: "github",
      model: "gpt-4.1",
    });
  });

  it("routes direct combo/name requests through the combo chain", async () => {
    const response = await handleChat(makeRequest("combo/sonnet"), {}, {});

    expect(response.status).toBe(200);
    expect(handleChatCore).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleChatCore).mock.calls[0][0].modelInfo).toEqual({
      provider: "github",
      model: "gpt-4.1",
    });
  });
});
