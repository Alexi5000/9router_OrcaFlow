import { afterEach, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import https from "node:https";
import tls from "node:tls";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const forge = require("node-forge");
const manager = fs.readFileSync(new URL("../../src/mitm/manager.js", import.meta.url), "utf8");
const rootSource = fs.readFileSync(new URL("../../src/mitm/cert/rootCA.js", import.meta.url), "utf8");
const start = manager.indexOf("function pollMitmHealth(");
const end = manager.indexOf("\n/**", start);
const probeSource = manager.slice(start, end);
const resources = [];
let trustedRoot;
let otherRoot;
let goodLeaf;
let wrongHostLeaf;
let otherLeaf;

function rootModule(directory) {
  const module = { exports: {} };
  vm.runInNewContext(rootSource, { module, process, console, require: name => name === "../paths" ? { MITM_DIR: directory } : require(name) });
  return module.exports;
}

beforeAll(async () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "orca-health-ca-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "orca-health-other-ca-"));
  try {
    const roots = [rootModule(first), rootModule(second)];
    await roots[0].generateRootCA();
    await roots[1].generateRootCA();
    trustedRoot = roots[0].loadRootCA();
    otherRoot = roots[1].loadRootCA();
    goodLeaf = roots[0].generateLeafCert("cloudcode-pa.googleapis.com", trustedRoot);
    wrongHostLeaf = roots[0].generateLeafCert("wrong.example.test", trustedRoot);
    otherLeaf = roots[1].generateLeafCert("cloudcode-pa.googleapis.com", otherRoot);
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
}, 20000);

afterEach(async () => {
  for (const server of resources.splice(0)) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

async function serverFor(leaf, payload = { ok: true, pid: 12345 }) {
  let requests = 0;
  let servername;
  const context = tls.createSecureContext(leaf);
  const server = https.createServer({ ...leaf, SNICallback(name, callback) { servername = name; callback(null, context); } }, (req, res) => {
    requests++;
    expect(req.url).toBe("/_mitm_health");
    if (payload === null) return;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  resources.push(server);
  return { port: server.address().port, requests: () => requests, servername: () => servername };
}

function probe(port, loadRootCA = () => trustedRoot, timeoutMs = 0) {
  return vm.runInNewContext(`${probeSource}\npollMitmHealth(timeoutMs, port);`, {
    https, forge, loadRootCA, port, timeoutMs, MITM_PORT: 443, setTimeout, clearTimeout, Date,
  });
}

it("authenticates the local MITM using its generated root and supported SNI domain", async () => {
  const server = await serverFor(goodLeaf);
  expect(await probe(server.port)).toEqual({ ok: true, pid: 12345 });
  expect(server.servername()).toBe("cloudcode-pa.googleapis.com");
  expect(server.requests()).toBe(1);
});

it("rejects an unrelated root before sending HTTP", async () => {
  const server = await serverFor(otherLeaf);
  expect(await probe(server.port)).toBeNull();
  expect(server.requests()).toBe(0);
});

it("rejects the wrong hostname even when signed by the trusted root", async () => {
  const server = await serverFor(wrongHostLeaf);
  expect(await probe(server.port)).toBeNull();
  expect(server.requests()).toBe(0);
});

it.each(["missing", "malformed"])("fails closed with a %s root without contacting the server", async kind => {
  const server = await serverFor(goodLeaf);
  const load = kind === "missing" ? () => { throw new Error("ENOENT"); } : () => ({ cert: {} });
  expect(await probe(server.port, load)).toBeNull();
  expect(server.requests()).toBe(0);
});

it("preserves unhealthy-service status handling", async () => {
  const server = await serverFor(goodLeaf, { ok: false });
  expect(await probe(server.port)).toBeNull();
  expect(server.requests()).toBe(1);
});

it("bounds a trusted server that never finishes the health response", async () => {
  const server = await serverFor(goodLeaf, null);
  const started = Date.now();
  expect(await probe(server.port, undefined, 100)).toBeNull();
  expect(Date.now() - started).toBeLessThan(2000);
  expect(server.requests()).toBe(1);
});
