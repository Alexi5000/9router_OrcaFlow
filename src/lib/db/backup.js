// DB safety backups — taken ONLY before a schema change (see migrate.js).
//
// ⚠️ AGENT/DEV NOTES:
// - Backups are a best-effort safety net before schema migrations. There is NO
//   automated restore path; recovery is manual (copy a backup file back).
// - Backups intentionally EXCLUDE the `requestDetails` table (observability log,
//   auto-pruned, non-critical) so a multi-hundred-MB DB backs up as a few MB.
// - Only the newest KEEP_BACKUPS are kept; older ones are pruned automatically.
import fs from "node:fs";
import path from "node:path";
import { BACKUPS_DIR, ensureDirs } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";

const KEEP_BACKUPS = 3;

// Tables excluded from safety backups (large, non-critical, reproducible).
const BACKUP_EXCLUDE_TABLES = ["requestDetails"];

export function makeBackupDir(label) {
  ensureDirs();
  const ver = getAppVersion();
  const slug = `${label}-${ver}-${timestampSlug()}`;
  return fs.mkdtempSync(path.join(BACKUPS_DIR, `${slug}-`));
}

export function backupFile(srcPath, destDir, destName = null) {
  let input;
  let output;
  try {
    input = fs.openSync(srcPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    if (!fs.fstatSync(input).isFile()) throw new Error("Invalid backup source");
    const name = destName || path.basename(srcPath);
    if (path.basename(name) !== name) throw new Error("Invalid backup name");
    const dest = path.join(destDir, name);
    output = fs.openSync(dest, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const buffer = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
      let offset = 0;
      while (offset < count) offset += fs.writeSync(output, buffer, offset, count - offset);
    }
    return dest;
  } catch (error) {
    if (input === undefined && error.code === "ENOENT") return null;
    throw error;
  } finally {
    if (input !== undefined) fs.closeSync(input);
    if (output !== undefined) fs.closeSync(output);
  }
}

// Lightweight DB backup via ATTACH: create an empty sqlite file, copy every
// table EXCEPT the excluded ones into it. Avoids duplicating the huge
// observability log, so the backup stays small regardless of DB size.
export function backupDbLite(adapter, destDir, destName = "data.sqlite") {
  const dest = path.join(destDir, destName);
  if (path.basename(destName) !== destName) throw new Error("Invalid backup name");
  fs.closeSync(fs.openSync(dest, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600));
  const escaped = dest.replace(/'/g, "''");

  adapter.exec(`ATTACH DATABASE '${escaped}' AS bak`);
  try {
    const excluded = new Set(BACKUP_EXCLUDE_TABLES);
    const tables = adapter
      .all(`SELECT name, sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .filter((t) => !excluded.has(t.name));

    adapter.transaction(() => {
      for (const t of tables) {
        // Recreate table structure in backup DB, then copy rows.
        const createSql = t.sql.replace(/CREATE TABLE\s+/i, "CREATE TABLE bak.");
        adapter.exec(createSql);
        adapter.exec(`INSERT INTO bak.${t.name} SELECT * FROM main.${t.name}`);
      }
    });
  } finally {
    try { adapter.exec("DETACH DATABASE bak"); } catch {}
  }
  return dest;
}

export function pruneOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, full: path.join(BACKUPS_DIR, e.name), mtime: fs.statSync(path.join(BACKUPS_DIR, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of entries.slice(KEEP_BACKUPS)) {
    try { fs.rmSync(old.full, { recursive: true, force: true }); } catch {}
  }
}
