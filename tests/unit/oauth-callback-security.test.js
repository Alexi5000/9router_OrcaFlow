import { describe, it, expect } from "vitest";
import { callbackTargetOrigins, trustedOAuthMessage, matchesOAuthState } from "../../src/shared/utils/oauthCallback.js";
describe("OAuth callback boundaries", () => {
  const popup = {};
  const auth = { redirectUri: "http://localhost:20128/callback", state: "random-state" };
  const event = { source: popup, origin: "http://localhost:20128", data: { type: "oauth_callback", data: { code: "code", state: auth.state } } };
  it("accepts only the expected popup, exact callback origin and state", () => {
    expect(trustedOAuthMessage(event, auth, popup)).toBe(true);
    expect(trustedOAuthMessage({ ...event, source: {} }, auth, popup)).toBe(false);
    expect(trustedOAuthMessage(event, auth, null)).toBe(false);
  });
  it.each(["https://localhost.evil.example", "http://localhost:9999", "https://evil.example/127.0.0.1"])("rejects spoofed origin %s", origin => {
    expect(trustedOAuthMessage({ ...event, origin }, auth, popup)).toBe(false);
  });
  it("rejects missing or mismatched state on every transport", () => {
    expect(matchesOAuthState({}, auth)).toBe(false);
    expect(matchesOAuthState({ state: "other" }, auth)).toBe(false);
    expect(matchesOAuthState({}, {})).toBe(false);
  });
  it("targets only the same origin and same-port loopback alias", () => {
    expect(callbackTargetOrigins("http://localhost:20128")).toEqual(["http://localhost:20128", "http://127.0.0.1:20128"]);
    expect(callbackTargetOrigins("https://router.example")).toEqual(["https://router.example"]);
  });
});
