import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";
const mocks = vi.hoisted(() => ({ settings: vi.fn(async () => ({ requireLogin: true })) }));
vi.mock("../../src/lib/localDb", () => ({ getSettings: mocks.settings }));
import { proxy } from "../../src/dashboardGuard.js";
const secret = "a-test-only-secret-with-more-than-32-characters";
function request(path, token, method = "GET", origin) {
  const url = new URL(`http://localhost:20128${path}`);
  return { nextUrl: url, url: url.href, method, cookies: { get: () => token ? { value: token } : undefined }, headers: new Headers(origin ? { origin } : {}) };
}
beforeEach(() => { process.env.JWT_SECRET = secret; mocks.settings.mockResolvedValue({ requireLogin: true }); });
describe("management authentication", () => {
  it.each(["/api/settings", "/api/keys", "/api/providers", "/api/cli-tools/opencode-settings", "/api/oauth/kiro/social-authorize", "/api/shutdown"])("protects %s", async path => {
    expect((await proxy(request(path))).status).toBe(401);
  });
  it.each(["/api/auth/login", "/api/settings/require-login", "/api/v1/chat/completions", "/api/v1beta/models/gemini:generateContent"])("preserves public protocol route %s", async path => {
    expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");
  });
  it("accepts the existing authenticated session claim", async () => {
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(secret));
    expect((await proxy(request("/api/settings", token))).headers.get("x-middleware-next")).toBe("1");
  });
  it("rejects signed tokens without the session claim", async () => {
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(secret));
    expect((await proxy(request("/api/settings", token))).status).toBe(401);
  });
  it("fails closed on database errors", async () => {
    mocks.settings.mockRejectedValue(new Error("offline"));
    expect((await proxy(request("/api/settings"))).status).toBe(401);
  });
  it("preserves explicitly disabled login", async () => {
    mocks.settings.mockResolvedValue({ requireLogin: false });
    expect((await proxy(request("/api/settings"))).headers.get("x-middleware-next")).toBe("1");
  });
  it("blocks foreign-origin management writes even with login disabled", async () => {
    mocks.settings.mockResolvedValue({ requireLogin: false });
    expect((await proxy(request("/api/settings", null, "PATCH", "https://evil.example"))).status).toBe(403);
  });
  it("rejects the old public signing secret", async () => {
    process.env.JWT_SECRET = "orcaflow-default-secret-change-me";
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect((await proxy(request("/api/settings", token))).status).toBe(401);
  });
});
