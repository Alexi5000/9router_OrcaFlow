import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { execFile } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = [
  "storage.serviceMachineId",
  "storage.machineId",
  "telemetry.machineId",
];

function getCandidatePaths(platform) {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(
        home,
        "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
      ),
      join(
        home,
        "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb",
      ),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData =
      process.env.LOCALAPPDATA || join(home, "AppData", "Local");

    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        appData,
        "Cursor - Insiders",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        localAppData,
        "Programs",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
    ];
  }

  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
}

function normalizeStoredValue(value) {
  if (typeof value !== "string") return value;

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
}

function extractTokens(db) {
  const desiredKeys = [...ACCESS_TOKEN_KEYS, ...MACHINE_ID_KEYS];
  const rows = db
    .prepare(
      `SELECT key, value FROM itemTable WHERE key IN (${desiredKeys.map(() => "?").join(",")})`,
    )
    .all(...desiredKeys);

  const tokens = {};
  for (const row of rows) {
    if (ACCESS_TOKEN_KEYS.includes(row.key) && !tokens.accessToken) {
      tokens.accessToken = normalizeStoredValue(row.value);
    } else if (MACHINE_ID_KEYS.includes(row.key) && !tokens.machineId) {
      tokens.machineId = normalizeStoredValue(row.value);
    }
  }

  if (!tokens.accessToken || !tokens.machineId) {
    const fallbackRows = db
      .prepare(
        "SELECT key, value FROM itemTable WHERE key LIKE '%cursorAuth/%' OR key LIKE '%machineId%' OR key LIKE '%serviceMachineId%'",
      )
      .all();

    for (const row of fallbackRows) {
      const key = row.key || "";
      const value = normalizeStoredValue(row.value);

      if (!tokens.accessToken && key.toLowerCase().includes("accesstoken")) {
        tokens.accessToken = value;
      }

      if (!tokens.machineId && key.toLowerCase().includes("machineid")) {
        tokens.machineId = value;
      }
    }
  }

  return tokens;
}

async function extractTokensViaCLI(dbPath) {
  const query = async (sql) => {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
      timeout: 10000,
    });
    return stdout.trim();
  };

  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        accessToken = normalizeStoredValue(raw);
        break;
      }
    } catch {
      // Try the next key.
    }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        machineId = normalizeStoredValue(raw);
        break;
      }
    } catch {
      // Try the next key.
    }
  }

  return { accessToken, machineId };
}

export async function GET() {
  try {
    const candidates = getCandidatePaths(process.platform);

    let dbPath = null;
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        dbPath = candidate;
        break;
      } catch {
        // Try the next candidate.
      }
    }

    if (!dbPath) {
      return NextResponse.json({
        found: false,
        error: `Cursor database not found. Checked locations:\n${candidates.join("\n")}\n\nMake sure Cursor IDE is installed and opened at least once.`,
      });
    }

    let Database = null;
    try {
      const mod = await import("better-sqlite3");
      Database = mod.default;
    } catch (error) {
      console.log("Cursor auto-import: bundled import failed:", error?.message);
    }

    if (Database) {
      let db;
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const tokens = extractTokens(db);
        db.close();

        if (tokens.accessToken && tokens.machineId) {
          return NextResponse.json({
            found: true,
            accessToken: tokens.accessToken,
            machineId: tokens.machineId,
          });
        }
      } catch {
        db?.close();
      }
    }

    try {
      const tokens = await extractTokensViaCLI(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
    } catch {
      // sqlite3 CLI not available.
    }

    return NextResponse.json({ found: false, windowsManual: true, dbPath });
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 },
    );
  }
}
