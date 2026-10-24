import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { chromium } from "@playwright/test";

test("browser presets encrypt, migrate, survive reload, and reject tampering", async () => {
  const source = await readFile(new URL("../../src/shared/utils/endpointPresetStorage.js", import.meta.url));
  const server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/storage.js" ? "application/javascript" : "text/html");
    response.end(request.url === "/storage.js" ? source : "<!doctype html><title>Preset storage regression</title>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const migrated = await page.evaluate(async () => {
      const storage = await import("/storage.js");
      const expected = [{ name: "test", baseUrl: "https://example.test", apiKey: "private-regression-key" }];
      localStorage.setItem("9router.cliToolEndpointPresets", JSON.stringify(expected));
      const presets = await storage.readEndpointPresets();
      return { presets, legacy: localStorage.getItem("9router.cliToolEndpointPresets"), encrypted: localStorage.getItem("9router.cliToolEndpointPresets.encrypted") };
    });
    assert.equal(migrated.presets[0].apiKey, "private-regression-key");
    assert.equal(migrated.legacy, null);
    assert.equal(migrated.encrypted.includes("private-regression-key"), false);
    await page.reload();
    assert.equal(await page.evaluate(async () => (await (await import("/storage.js")).readEndpointPresets())[0].apiKey), "private-regression-key");
    assert.equal(await page.evaluate(async () => {
      const key = "9router.cliToolEndpointPresets.encrypted";
      const data = JSON.parse(localStorage.getItem(key));
      data.data[0] ^= 1;
      localStorage.setItem(key, JSON.stringify(data));
      try { await (await import("/storage.js")).readEndpointPresets(); return false; }
      catch { return true; }
    }), true);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
