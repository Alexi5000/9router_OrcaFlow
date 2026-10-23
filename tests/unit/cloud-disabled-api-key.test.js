/**
 * Regression tests: cloud inference and verify handlers must reject stored
 * API keys whose record is disabled (isActive === false), matching the local
 * validator in src/lib/localDb.js. Disabled keys must never reach provider
 * execution (handleChatCore / handleEmbeddingsCore).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/handlers/chatCore.js", () => ({ handleChatCore: vi.fn() }));
vi.mock("../../open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: vi.fn() }));
vi.mock("../../open-sse/services/model.js", () => ({ getModelInfoCore: vi.fn() }));
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
vi.mock("../../cloud/src/services/tokenRefresh.js", () => ({ refreshTokenByProvider: vi.fn() }));

import { isActiveStoredApiKey } from "../../cloud/src/utils/apiKeyAccess.js";
import { handleChat } from "../../cloud/src/handlers/chat.js";
import { handleEmbeddings } from "../../cloud/src/handlers/embeddings.js";
import { handleVerify } from "../../cloud/src/handlers/verify.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { parseApiKey, extractBearerToken } from "../../cloud/src/utils/apiKey.js";
import { getMachineData, saveMachineData } from "../../cloud/src/services/storage.js";

const MACHINE_ID = "mach01";
const API_KEY = "sk-mach01-key01-ab12cd34";

function machineData(keyRecord) {
  return {
    apiKeys: [keyRecord],
    modelAliases: {},
    providers: {
      "conn-001": {
        provider: "openai",
        apiKey: "sk-openai-provider-dummy",
        isActive: true,
        priority: 1,
        status: "active",
        rateLimitedUntil: null,
      },
    },
  };
}

function request(path, body) {
  return new Request(`https://cloud.example.test${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function okResult() {
  return {
    success: true,
    response: new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

describe("isActiveStoredApiKey", () => {
  it("accepts an exact active key and a key with no isActive field", () => {
    expect(isActiveStoredApiKey([{ key: API_KEY, isActive: true }], API_KEY)).toBe(true);
    expect(isActiveStoredApiKey([{ key: API_KEY }], API_KEY)).toBe(true);
  });

  it("rejects a disabled key, a missing key, and malformed inputs", () => {
    expect(isActiveStoredApiKey([{ key: API_KEY, isActive: false }], API_KEY)).toBe(false);
    expect(isActiveStoredApiKey([{ key: "sk-other" }], API_KEY)).toBe(false);
    expect(isActiveStoredApiKey(undefined, API_KEY)).toBe(false);
    expect(isActiveStoredApiKey([null, { key: API_KEY, isActive: false }], API_KEY)).toBe(false);
    expect(isActiveStoredApiKey([{ key: "" }], "")).toBe(false);
  });

  it("does not let a disabled duplicate shadow an active record", () => {
    const keys = [{ key: API_KEY, isActive: false }, { key: API_KEY, isActive: true }];
    expect(isActiveStoredApiKey(keys, API_KEY)).toBe(true);
  });
});

describe("cloud handlers reject disabled stored API keys", () => {
  beforeEach(() => {
    vi.mocked(extractBearerToken).mockReturnValue(API_KEY);
    vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
    vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "gpt-4.1" });
    vi.mocked(saveMachineData).mockResolvedValue(undefined);
    vi.mocked(handleChatCore).mockImplementation(async () => okResult());
    vi.mocked(handleEmbeddingsCore).mockImplementation(async () => okResult());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe.each([
    ["new-format key routing", null],
    ["legacy explicit machine routing", MACHINE_ID],
  ])("%s", (_label, machineOverride) => {
    it("chat: disabled key returns 401 and never calls the provider", async () => {
      vi.mocked(getMachineData).mockResolvedValue(machineData({ key: API_KEY, isActive: false }));
      const res = await handleChat(
        request("/v1/chat/completions", { model: "openai/gpt-4.1", messages: [{ role: "user", content: "hi" }] }),
        {},
        {},
        machineOverride
      );
      expect(res.status).toBe(401);
      expect(handleChatCore).not.toHaveBeenCalled();
    });

    it("chat: active key still reaches the provider", async () => {
      vi.mocked(getMachineData).mockResolvedValue(machineData({ key: API_KEY, isActive: true }));
      const res = await handleChat(
        request("/v1/chat/completions", { model: "openai/gpt-4.1", messages: [{ role: "user", content: "hi" }] }),
        {},
        {},
        machineOverride
      );
      expect(res.status).toBe(200);
      expect(handleChatCore).toHaveBeenCalledTimes(1);
    });

    it("embeddings: disabled key returns 401 and never calls the provider", async () => {
      vi.mocked(getMachineData).mockResolvedValue(machineData({ key: API_KEY, isActive: false }));
      const res = await handleEmbeddings(
        request("/v1/embeddings", { model: "openai/text-embedding-3-small", input: "hi" }),
        {},
        {},
        machineOverride
      );
      expect(res.status).toBe(401);
      expect(handleEmbeddingsCore).not.toHaveBeenCalled();
    });

    it("embeddings: active key still reaches the provider", async () => {
      vi.mocked(getMachineData).mockResolvedValue(machineData({ key: API_KEY }));
      const res = await handleEmbeddings(
        request("/v1/embeddings", { model: "openai/text-embedding-3-small", input: "hi" }),
        {},
        {},
        machineOverride
      );
      expect(res.status).toBe(200);
      expect(handleEmbeddingsCore).toHaveBeenCalledTimes(1);
    });

    it("verify: disabled key returns 401, active key returns valid:true", async () => {
      vi.mocked(getMachineData).mockResolvedValue(machineData({ key: API_KEY, isActive: false }));
      const denied = await handleVerify(request("/verify"), {}, machineOverride);
      expect(denied.status).toBe(401);

      vi.mocked(getMachineData).mockResolvedValue(machineData({ key: API_KEY, isActive: true }));
      const allowed = await handleVerify(request("/verify"), {}, machineOverride);
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).valid).toBe(true);
    });
  });
});
