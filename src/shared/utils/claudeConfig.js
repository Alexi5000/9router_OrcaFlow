import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WINDOWS_ADMIN_CLAUDE_DIR = "/mnt/c/Users/Admin/.claude";

export function getClaudeSettingsCandidates() {
  const homeDir = os.homedir();
  return [
    path.join(WINDOWS_ADMIN_CLAUDE_DIR, "settings.json"),
    path.join(homeDir, ".claude", "settings.json"),
  ];
}

export function resolveClaudeSettingsPath() {
  for (const candidate of getClaudeSettingsCandidates()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return getClaudeSettingsCandidates()[0];
}
