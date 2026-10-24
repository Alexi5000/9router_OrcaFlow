// Verify schema migration chain runs correctly across versions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mig-"));
  process.env.DATA_DIR = tempDir;
  // Reset global singleton so each test gets fresh adapter pointed at tempDir
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  // Close adapter to release file handles before rm
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Schema migrations", () => {
  it("fresh DB → applies migrations & stamps schemaVersion", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map(t => t.name);
    expect(tables).toEqual(expect.arrayContaining([
      "_meta", "settings", "providerConnections", "providerNodes",
      "proxyPools", "apiKeys", "combos", "kv", "usageHistory", "usageDaily", "requestDetails",
    ]));
  });

  it("existing DB at older schemaVersion → re-applies pending migrations on restart", async () => {
    // 1st boot
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, ['{"foo":"bar"}']);
    db.run(`UPDATE _meta SET value = '0' WHERE key = 'schemaVersion'`);
    db.close?.();

    // 2nd boot: full reset to simulate process restart
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db2 = await getAdapter2();
    const row = db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const settings = db2.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "bar" });
  });

  it("fresh DB + legacy db.json → imports data automatically", async () => {
    // Simulate user upgrading: place legacy JSON in DATA_DIR before first boot
    const legacy = {
      settings: { foo: "legacy-value" },
      apiKeys: [{ id: "k1", key: "abc", name: "test", createdAt: new Date().toISOString() }],
      modelAliases: { "gpt-4": "gpt-4-turbo" },
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const settings = db.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "legacy-value" });

    const keys = db.all(`SELECT * FROM apiKeys`);
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe("abc");

    const aliases = db.all(`SELECT * FROM kv WHERE scope='modelAliases'`);
    expect(aliases).toHaveLength(1);
  });

  it("auto-sync re-creates missing index when DB lacks it", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.exec(`DROP INDEX IF EXISTS idx_pn_type`);
    expect(db.all(`PRAGMA index_list(providerNodes)`).map(i => i.name)).not.toContain("idx_pn_type");
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const idx = db2.all(`PRAGMA index_list(providerNodes)`).map(i => i.name);
    expect(idx).toContain("idx_pn_type");
  });
});


describe("Fork database preservation", () => {
  it("retains route metadata, custom pricing and observability across import and restart", async () => {
    const route = { requestedModel: "custom", finalModel: "provider/model", reason: "fork-router" };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify({ settings: { enableObservability: false }, pricing: { custom: { model: { input: 0.123, output: 0.456 } } } }));
    fs.writeFileSync(path.join(tempDir, "usage.json"), JSON.stringify({ history: [{ model: "model", provider: "custom", route, tokens: { prompt_tokens: 12 }, timestamp: "2026-10-24T00:00:00Z" }] }));
    let { getAdapter } = await import("@/lib/db/driver.js");
    let db = await getAdapter();
    db.close(); delete global._dbAdapter; vi.resetModules();
    ({ getAdapter } = await import("@/lib/db/driver.js")); db = await getAdapter();
    expect(JSON.parse(db.get("SELECT meta FROM usageHistory").meta).route).toEqual(route);
    expect(db.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(1);
    expect(JSON.parse(db.get("SELECT data FROM settings WHERE id=1").data).enableObservability).toBe(false);
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='custom'").value).model.input).toBe(0.123);
    if (process.platform !== "win32") {
      expect(fs.statSync(path.join(tempDir, "db")).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(tempDir, "db/data.sqlite")).mode & 0o777).toBe(0o600);
      const backup = fs.readdirSync(path.join(tempDir, "db/backups"))[0];
      expect(fs.statSync(path.join(tempDir, "db/backups", backup, "db.json")).mode & 0o777).toBe(0o600);
    }
  });

  it("fails closed on malformed legacy JSON and imports after correction", async () => {
    fs.writeFileSync(path.join(tempDir, "db.json"), "{broken");
    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toThrow();
    expect(fs.existsSync(path.join(tempDir, "db/.migrated-from-json"))).toBe(false);
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify({ settings: { recovered: true } }));
    delete global._dbAdapter; vi.resetModules();
    const { getAdapter: retry } = await import("@/lib/db/driver.js");
    const db = await retry();
    expect(JSON.parse(db.get("SELECT data FROM settings WHERE id=1").data).recovered).toBe(true);
  });

  it.skipIf(process.platform === "win32")("rejects linked database targets without modifying the target", async () => {
    fs.mkdirSync(path.join(tempDir, "db"));
    const target = path.join(tempDir, "outside"); fs.writeFileSync(target, "untouched");
    fs.symlinkSync(target, path.join(tempDir, "db/data.sqlite"));
    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("untouched");
  });

  it("initializes the sql.js fallback from a protected empty file", async () => {
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const file = path.join(tempDir, "fallback.sqlite"); fs.writeFileSync(file, "", { mode: 0o600 });
    const db = await createSqlJsAdapter(file);
    try { expect(db.get("SELECT 1 AS value").value).toBe(1); } finally { db.close(); }
  });
});
