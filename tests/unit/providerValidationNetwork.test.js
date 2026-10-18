import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generate } from "selfsigned";
import { validateProvider } from "../../src/lib/network/providerValidation.js";
import { POST } from "../../src/app/api/provider-nodes/validate/route.js";

const servers = [];
async function listen(server) {
  servers.push(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

describe("provider validation network boundary", () => {
  it("returns policy rejection, success, and invalid-key results through the API handler", async () => {
    let requests = 0;
    const port = await listen(httpServer((request, response) => {
      requests++;
      response.writeHead(request.headers.authorization === "Bearer valid-key" ? 200 : 401);
      response.end("{}");
    }));
    const origin = "http://127.0.0.1:" + port;
    const call = key => POST(new Request("http://localhost/api/provider-nodes/validate", {
      method: "POST", body: JSON.stringify({ baseUrl: origin + "/v1", apiKey: key }),
    }));
    const denied = await call("valid-key");
    expect(denied.status).toBe(400);
    expect((await denied.json()).valid).toBe(false);
    expect(requests).toBe(0);
    vi.stubEnv("PROVIDER_VALIDATION_ALLOWED_ORIGINS", origin);
    const accepted = await call("valid-key");
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ valid: true, error: null });
    const invalid = await call("invalid-key");
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({ valid: false, error: "Invalid API key or unauthorized" });
    expect(requests).toBe(2);
  });

  it("blocks a real loopback server unless its origin is explicitly configured", async () => {
    const received = [];
    const port = await listen(httpServer((request, response) => {
      received.push({ url: request.url, key: request.headers.authorization });
      response.end("{}");
    }));
    const origin = "http://127.0.0.1:" + port;
    await expect(validateProvider(origin + "/v1", "test-key")).rejects.toThrow();
    expect(received).toEqual([]);
    vi.stubEnv("PROVIDER_VALIDATION_ALLOWED_ORIGINS", origin);
    await expect(validateProvider(origin + "/v1", "test-key")).resolves.toBe(true);
    expect(received).toEqual([{ url: "/v1/models", key: "Bearer test-key" }]);
  });

  it("does not follow redirects or forward credentials to another origin", async () => {
    let destinationRequests = 0;
    const destination = await listen(httpServer((_request, response) => {
      destinationRequests++;
      response.end("{}");
    }));
    const source = await listen(httpServer((_request, response) => {
      response.writeHead(302, { Location: "http://127.0.0.1:" + destination + "/metadata" });
      response.end();
    }));
    const origin = "http://127.0.0.1:" + source;
    vi.stubEnv("PROVIDER_VALIDATION_ALLOWED_ORIGINS", origin);
    await expect(validateProvider(origin, "secret-key")).rejects.toThrow();
    expect(destinationRequests).toBe(0);
  });

  it("keeps certificate verification enabled for explicitly allowed HTTPS providers", async () => {
    const cert = await generate([{ name: "commonName", value: "localhost" }], { keySize: 2048 });
    let requests = 0;
    const port = await listen(httpsServer({ key: cert.private, cert: cert.cert }, (_request, response) => {
      requests++;
      response.end("{}");
    }));
    const origin = "https://127.0.0.1:" + port;
    vi.stubEnv("PROVIDER_VALIDATION_ALLOWED_ORIGINS", origin);
    await expect(validateProvider(origin, "secret-key")).rejects.toThrow();
    expect(requests).toBe(0);
  });
});
