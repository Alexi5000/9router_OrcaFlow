import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { promisify } from "node:util";

function loadServer() {
  let handler;
  let ssl;
  const request = vi.fn(() => ({ on() {}, end() {}, write() {} }));
  const resolve4 = vi.fn((host, callback) => callback(null, ["142.250.1.1"]));
  const server = { listen() {}, on() {}, close() {} };
  const modules = {
    https: { createServer(options, callback) { ssl = options; handler = callback; return server; }, request },
    fs: { readFileSync: () => "certificate", existsSync: () => false },
    path,
    dns: { Resolver: class { setServers() {} resolve4(...args) { resolve4(...args); } } },
    util: { promisify },
    crypto: { randomUUID: () => "unique-log-id" },
    "./paths": { DATA_DIR: "/data", MITM_DIR: "/certs" },
    "./cert/generate": { getCertForDomain: vi.fn(() => ({ key: "key", cert: "cert" })) },
    tls: { createSecureContext: () => ({}) },
  };
  vm.runInNewContext(readFileSync(new URL("../../src/mitm/server.js", import.meta.url), "utf8"), {
    require: name => modules[name],
    process: { env: { ROUTER_API_KEY: "test" }, on() {}, platform: "linux" },
    console: { log() {}, error() {} },
    __dirname: "/app/src/mitm", Buffer,
  });
  return { handler, ssl, request, resolve4 };
}
function req(host) {
  return { headers: { host }, url: "/unmapped", method: "GET", on(event, callback) { if (event === "end") callback(); } };
}
function res() { return { writeHead: vi.fn(), end: vi.fn() }; }

describe("MITM upstream boundaries", () => {
  it.each(["attacker.example", "__proto__", "constructor", "api.individual.githubcopilot.com:444", "api.individual.githubcopilot.com.evil.test", ""])('rejects unconfigured Host %s before DNS or forwarding', async host => {
    const app = loadServer();
    const response = res();
    await app.handler(req(host), response);
    expect(response.writeHead).toHaveBeenCalledWith(421);
    expect(app.resolve4).not.toHaveBeenCalled();
    expect(app.request).not.toHaveBeenCalled();
  });
  it.each(["api.individual.githubcopilot.com", "cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com:443"])("preserves trusted forwarding and validates TLS for %s", async host => {
    const app = loadServer();
    await app.handler(req(host), res());
    expect(app.request).toHaveBeenCalledWith(expect.objectContaining({ servername: host.split(":")[0], rejectUnauthorized: true, hostname: "142.250.1.1" }), expect.any(Function));
  });
  it("rejects unsupported SNI without generating a certificate", () => {
    const app = loadServer();
    const callback = vi.fn();
    app.ssl.SNICallback("attacker.example", callback);
    expect(callback.mock.calls[0][0].message).toBe("Unsupported interception hostname");
  });
});
