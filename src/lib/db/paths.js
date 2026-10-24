import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";

export const DB_DIR = path.join(DATA_DIR, "db");
export const DATA_FILE = path.join(DB_DIR, "data.sqlite");
export const BACKUPS_DIR = path.join(DB_DIR, "backups");
export const LEGACY_FILES = {
  main: path.join(DATA_DIR, "db.json"),
  usage: path.join(DATA_DIR, "usage.json"),
  disabled: path.join(DATA_DIR, "disabledModels.json"),
  details: path.join(DATA_DIR, "request-details.json"),
};
export function ensureDirs() {
  for (const dir of [DATA_DIR, DB_DIR, BACKUPS_DIR]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (dir === DATA_DIR) continue;
    if (process.platform === "win32") {
      if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw new Error("Invalid database directory");
      continue;
    }
    const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      if (!fs.fstatSync(fd).isDirectory()) throw new Error("Invalid database directory");
      fs.fchmodSync(fd, 0o700);
    } finally { fs.closeSync(fd); }
  }
}

export function prepareDatabaseFile() {
  for (const file of [DATA_FILE, `${DATA_FILE}-wal`, `${DATA_FILE}-shm`]) {
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | (file === DATA_FILE ? fs.constants.O_CREAT : 0), 0o600);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error("Invalid database file");
      if (process.platform !== "win32") fs.fchmodSync(fd, 0o600);
    } catch (error) {
      if (file === DATA_FILE || error.code !== "ENOENT") throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
}
