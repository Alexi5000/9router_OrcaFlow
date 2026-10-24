import fs from "fs";
import managedFiles from "@/lib/managedFiles";
import path from "path";
import { TUNNEL_DIR, ensureTunnelDir } from "../shared/state.js";

const PID_FILE = path.join(TUNNEL_DIR, "cloudflared.pid");

export function savePid(pid) {
  ensureTunnelDir();
  managedFiles.writeFile(PID_FILE, pid.toString());
}

export function loadPid() {
  try {
    if (fs.existsSync(PID_FILE)) return parseInt(managedFiles.readFile(PID_FILE, "utf8"));
  } catch { /* ignore */ }
  return null;
}

export function clearPid(expectedPid = null) {
  try {
    if (!fs.existsSync(PID_FILE)) return false;
    if (expectedPid !== null && loadPid() !== expectedPid) return false;
    managedFiles.unlink(PID_FILE);
    return true;
  } catch { /* ignore */ }
  return false;
}
