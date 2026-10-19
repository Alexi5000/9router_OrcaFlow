import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

afterEach(() => vi.restoreAllMocks());

describe("Codex session headers", () => {
  it("generates distinct sessions at the same timestamp without Math.random", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234567890000);
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("noncryptographic randomness used");
    });
    const executor = new CodexExecutor();
    const ids = Array.from({ length: 100 }, () => executor.buildHeaders({}).session_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^1234567890000-[a-f0-9]{32}$/);
  });

  it("preserves authorization and stream negotiation", () => {
    const executor = new CodexExecutor();
    const streaming = executor.buildHeaders({ accessToken: "fixture-token" });
    expect(streaming.Authorization).toBe("Bearer fixture-token");
    expect(streaming.Accept).toBe("text/event-stream");
    expect(streaming["Content-Type"]).toBe("application/json");
    const plain = executor.buildHeaders({ apiKey: "fixture-key" }, false);
    expect(plain.Authorization).toBe("Bearer fixture-key");
    expect(plain.Accept).toBeUndefined();
  });

  it("fails closed when secure randomness is unavailable", () => {
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("secure randomness unavailable");
    });
    expect(() => new CodexExecutor().buildHeaders({})).toThrow("secure randomness unavailable");
  });
});
