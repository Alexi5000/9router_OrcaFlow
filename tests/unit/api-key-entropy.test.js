import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

vi.mock("../../src/lib/tunnel/state.js", () => ({
  loadState: vi.fn(() => ({ shortId: "fixture" })), saveState: vi.fn(), clearState: vi.fn(),
}));
vi.mock("../../src/lib/tunnel/cloudflared.js", () => ({
  spawnCloudflared: vi.fn(), killCloudflared: vi.fn(), isCloudflaredRunning: vi.fn(() => false),
  setUnexpectedExitHandler: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(() => ({})), updateSettings: vi.fn() }));

import { generateApiKeyWithMachine, parseApiKey } from "../../src/shared/utils/apiKey.js";
import { parseApiKey as parseCloudKey } from "../../cloud/src/utils/apiKey.js";
import { enableTunnel } from "../../src/lib/tunnel/tunnelManager.js";
import { loadState } from "../../src/lib/tunnel/state.js";

beforeEach(() => {
  vi.stubGlobal("crypto", crypto.webcrypto);
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ token: "fixture", hostname: "fixture.example" }) })));
  loadState.mockReturnValue({ shortId: "fixture" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("API key entropy and format compatibility", () => {
  it("generates 128-bit identifiers without Math.random and preserves both parsers", async () => {
    vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("predictable entropy forbidden"); });
    const { key, keyId } = generateApiKeyWithMachine("0123456789abcdef");
    expect(keyId).toMatch(/^[a-f0-9]{32}$/);
    const expected = { machineId: "0123456789abcdef", keyId, isNewFormat: true };
    expect(parseApiKey(key)).toEqual(expected);
    expect(await parseCloudKey(key)).toEqual(expected);
  });

  it("continues accepting existing six-character key IDs and old keys", async () => {
    const machineId = "0123456789abcdef";
    const keyId = "abc123";
    const crc = crypto.createHmac("sha256", "endpoint-proxy-api-key-secret").update(machineId + keyId).digest("hex").slice(0, 8);
    for (const parse of [parseApiKey, parseCloudKey]) {
      expect(await parse(`sk-${machineId}-${keyId}-${crc}`)).toEqual({ machineId, keyId, isNewFormat: true });
      expect(await parse("sk-oldkey12")).toEqual({ machineId: null, keyId: "oldkey12", isNewFormat: false });
    }
  });

  it("fails closed when cryptographic entropy is unavailable", () => {
    vi.spyOn(crypto, "randomBytes").mockImplementation(() => { throw new Error("entropy unavailable"); });
    expect(() => generateApiKeyWithMachine("0123456789abcdef")).toThrow("entropy unavailable");
  });

  it("uses the same strong entropy for actual tunnel session requests", async () => {
    vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("predictable entropy forbidden"); });
    await enableTunnel();
    expect(fetch).toHaveBeenCalledTimes(2);
    const bodies = fetch.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(bodies[0].apiKey).toMatch(/^sk-[a-f0-9]{16}-[a-f0-9]{32}-[a-f0-9]{8}$/);
    expect(bodies[1].apiKey).toBe(bodies[0].apiKey);
  });

  it("does not send a weak tunnel key when entropy fails", async () => {
    vi.spyOn(crypto, "randomBytes").mockImplementation(() => { throw new Error("entropy unavailable"); });
    await expect(enableTunnel()).rejects.toThrow("entropy unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reuses an existing tunnel credential without silently rotating it", async () => {
    loadState.mockReturnValue({ shortId: "fixture", apiKey: "existing-approved-key" });
    vi.spyOn(crypto, "randomBytes").mockImplementation(() => { throw new Error("entropy unavailable"); });
    await enableTunnel();
    expect(JSON.parse(fetch.mock.calls[0][1].body).apiKey).toBe("existing-approved-key");
  });
});
