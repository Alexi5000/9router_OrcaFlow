import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(), fetch: vi.fn(), destroy: vi.fn(), agents: [],
}));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({
  Agent: class {
    constructor(options) { this.options = options; mocks.agents.push(this); }
    destroy() { return mocks.destroy(); }
  },
  fetch: mocks.fetch,
}));
import { isPublicAddress, validateProvider } from "../../src/lib/network/providerValidation.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agents.length = 0;
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.fetch.mockResolvedValue({ ok: true, body: { cancel: vi.fn() } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("provider validation destination policy", () => {
  it.each([
    "127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1",
    "100.100.100.200", "0.0.0.0", "224.0.0.1", "240.0.0.1", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:a00:1",
    "64:ff9b::a00:1", "2002:7f00:1::", "2001:db8::1",
  ])("rejects nonpublic address %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "accepts public address %s", address => expect(isPublicAddress(address)).toBe(true),
  );

  it.each([
    "file:///etc/passwd", "ftp://example.com", "http://user:pass@example.com",
    "http://127.1", "http://2130706433", "http://0x7f000001",
    "http://[::ffff:127.0.0.1]", "https://example.com/?target=private",
    "https://example.com/#private",
  ])("rejects unsafe URL before network fetch: %s", async url => {
    await expect(validateProvider(url, "secret")).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "93.184.216.34", family: 4 }, { address: "::1", family: 6 }],
    [],
  ])("rejects nonpublic and mixed DNS answers", async addresses => {
    mocks.lookup.mockResolvedValue(addresses);
    await expect(validateProvider("https://custom.provider.example/v1", "secret")).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["http", "https"])("pins checked DNS for %s without changing TLS hostname", async protocol => {
    await expect(validateProvider(protocol + "://custom.provider.example/v1", "secret")).resolves.toBe(true);
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const callback = vi.fn();
    mocks.agents[0].options.connect.lookup("custom.provider.example", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }], 4);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url.href).toBe(protocol + "://custom.provider.example/v1/models");
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.headers.Authorization).toBe("Bearer secret");
    expect(mocks.agents[0].options.connect.rejectUnauthorized).toBeUndefined();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("allows exact server-configured local origins and preserves Anthropic headers", async () => {
    vi.stubEnv("PROVIDER_VALIDATION_ALLOWED_ORIGINS", "http://127.0.0.1:11434");
    await expect(validateProvider("http://127.0.0.1:11434/v1/messages", "key", "anthropic-compatible"))
      .resolves.toBe(true);
    expect(mocks.fetch.mock.calls[0][0].href).toBe("http://127.0.0.1:11434/v1/models");
    expect(mocks.fetch.mock.calls[0][1].headers["x-api-key"]).toBe("key");
    await expect(validateProvider("http://127.0.0.1:11435/v1", "key")).rejects.toThrow();
  });

  it("destroys its dispatcher on network or abort failure", async () => {
    mocks.fetch.mockRejectedValue(new Error("timeout"));
    await expect(validateProvider("https://provider.example", "key")).rejects.toThrow("timeout");
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("bounds DNS waiting without making a request", async () => {
    vi.useFakeTimers();
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    const pending = expect(validateProvider("https://provider.example", "key")).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
