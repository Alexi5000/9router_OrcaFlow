import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { exchangeKiroCallback } from "../../src/shared/utils/kiroCallback.js";

const callback = "kiro://kiro.kiroAgent/authenticate-success?code=code&state=expected";
let pending;
let send;
beforeEach(() => {
  pending = { current: { state: "expected", codeVerifier: "verifier", provider: "google" } };
  send = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
  vi.stubGlobal("fetch", send);
});
afterEach(() => vi.unstubAllGlobals());
describe("Kiro manual callback binding", () => {
  it.each(["", "&state=", "&state=other"])("rejects missing or mismatched state %s without exchange", async state => {
    await expect(exchangeKiroCallback(`kiro://callback?code=code${state}`, pending, "google")).rejects.toThrow("state");
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["kiro://kiro.kiroAgent/authenticate-success", "http://localhost:20128/callback"])("preserves valid callback transport %s", async base => {
    await expect(exchangeKiroCallback(`${base}?code=code&state=expected`, pending, "google")).resolves.toEqual({ success: true });
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ code: "code", codeVerifier: "verifier", provider: "google" });
    expect(send.mock.calls[0][0]).toBe("/api/oauth/kiro/social-exchange");
  });
  it("rejects repeated and concurrent submissions before another exchange", async () => {
    const first = exchangeKiroCallback(callback, pending, "google");
    await expect(exchangeKiroCallback(callback, pending, "google")).rejects.toThrow("state");
    await first;
    await expect(exchangeKiroCallback(callback, pending, "google")).rejects.toThrow("state");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects callback from an earlier attempt", async () => {
    pending.current.state = "new-attempt";
    await expect(exchangeKiroCallback(callback, pending, "google")).rejects.toThrow("state");
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects a changed provider", async () => {
    await expect(exchangeKiroCallback(callback, pending, "github")).rejects.toThrow("state");
    expect(send).not.toHaveBeenCalled();
  });
  it.each([null, {}, { state: "", provider: "google" }])("fails closed without valid pending initiation %j", async auth => {
    pending.current = auth;
    await expect(exchangeKiroCallback(callback, pending, "google")).rejects.toThrow("state");
    expect(send).not.toHaveBeenCalled();
  });
  it("does not reuse an attempted exchange after network failure", async () => {
    send.mockRejectedValue(new Error("network"));
    await expect(exchangeKiroCallback(callback, pending, "google")).rejects.toThrow("network");
    await expect(exchangeKiroCallback(callback, pending, "google")).rejects.toThrow("state");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("retains a pending attempt after malformed input so it can be corrected", async () => {
    await expect(exchangeKiroCallback("not-a-url", pending, "google")).rejects.toThrow("format");
    await exchangeKiroCallback(callback, pending, "google");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("handles upstream OAuth errors without exchange", async () => {
    await expect(exchangeKiroCallback("kiro://callback?state=expected&error=access_denied", pending, "google")).rejects.toThrow("access_denied");
    expect(send).not.toHaveBeenCalled();
  });
});
