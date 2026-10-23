import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() }));
vi.mock("@/lib/managedFiles", () => ({ default: io }));
import { POST } from "@/app/api/cli-tools/deepseek-settings/route.js";
import {
  normalizeDeepSeekCliApiUrl, normalizeDeepSeekCliBaseUrl, isLocalDeepSeekRouterUrl,
} from "@/shared/utils/deepseekCliConfig.js";

const post = (changes = {}) => POST({ json: async () => ({
  baseUrl: "http://localhost:20128", model: "deepseek-chat", ...changes,
}) });

beforeEach(() => {
  vi.clearAllMocks();
  io.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
});

describe("DeepSeek URL boundaries", () => {
  it.each([
    ["https://api.deepseek.com", "https://api.deepseek.com/chat/completions"],
    ["https://API.DEEPSEEK.COM:443/", "https://api.deepseek.com/chat/completions"],
    ["https://api.deepseek.com.evil.test", "https://api.deepseek.com.evil.test/v1/chat/completions"],
    ["http://localhost:20128", "http://localhost:20128/v1/chat/completions"],
    ["https://proxy.test/v1/?tenant=a", "https://proxy.test/v1/chat/completions?tenant=a"],
    ["https://proxy.test/chat/completions?tenant=a", "https://proxy.test/chat/completions?tenant=a"],
  ])("normalizes %s by URL components", (input, expected) => {
    expect(normalizeDeepSeekCliApiUrl(input)).toBe(expected);
  });

  it("keeps query parameters separate from a base URL path", () => {
    expect(normalizeDeepSeekCliBaseUrl("https://proxy.test/chat/completions?tenant=a"))
      .toBe("https://proxy.test/?tenant=a");
    expect(normalizeDeepSeekCliBaseUrl("https://proxy.test?tenant=a"))
      .toBe("https://proxy.test/v1?tenant=a");
  });

  it.each(["http://localhost:20128", "http://127.0.0.1:20128/v1", "http://[::1]:20128/v1"])(
    "recognizes the local router %s", url => expect(isLocalDeepSeekRouterUrl(url)).toBe(true),
  );
  it.each([
    "https://evil.test/localhost:20128", "http://localhost:20128@evil.test",
    "http://localhost:201280", "https://evil.test?next=127.0.0.1:20128", {},
  ])("does not recognize lookalike router URL %j", url => expect(isLocalDeepSeekRouterUrl(url)).toBe(false));
});

describe("DeepSeek settings preserve existing configuration", () => {
  it.each([
    { baseUrl: {} }, { baseUrl: "javascript:alert(1)" }, { baseUrl: "file:///etc/passwd" },
    { baseUrl: "https://api.deepseek.com@evil.test" }, { baseUrl: "https://proxy.test/#fragment" },
    { baseUrl: "not-a-url" }, { baseUrl: " " }, { model: {} }, { model: " " }, { apiKey: [] },
  ])("rejects invalid settings %j before filesystem changes", async changes => {
    expect((await post(changes)).status).toBe(400);
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(io.mkdir).not.toHaveBeenCalled();
  });

  it.each(["EACCES", "EIO"])("preserves unreadable config on %s", async code => {
    io.readFile.mockRejectedValue(Object.assign(new Error("unreadable"), { code }));
    expect((await post()).status).toBe(500);
    expect(io.writeFile).not.toHaveBeenCalled();
  });
  it.each(["{broken", "null", "[]", "42", '"text"'])("preserves invalid config %s", async config => {
    io.readFile.mockResolvedValue(config);
    expect((await post()).status).toBeGreaterThanOrEqual(400);
    expect(io.writeFile).not.toHaveBeenCalled();
  });
  it("creates an absent configuration", async () => {
    expect((await post()).status).toBe(200);
    expect(JSON.parse(io.writeFile.mock.calls[0][1])).toEqual({
      baseUrl: "http://localhost:20128/v1", apiUrl: "http://localhost:20128/v1/chat/completions",
      model: "deepseek-chat", apiKey: "sk_9router",
    });
  });
  it("retains unrelated preferences", async () => {
    io.readFile.mockResolvedValue('{"theme":"dark"}');
    expect((await post()).status).toBe(200);
    expect(JSON.parse(io.writeFile.mock.calls[0][1]).theme).toBe("dark");
  });
});
