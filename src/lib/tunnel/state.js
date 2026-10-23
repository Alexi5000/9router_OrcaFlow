import fs from "fs";
import managedFiles from "../managedFiles";
import path from "path";
import os from "os";

const TUNNEL_DIR = path.join(os.homedir(), ".9router", "tunnel");
const STATE_FILE = path.join(TUNNEL_DIR, "state.json");
const PID_FILE = path.join(TUNNEL_DIR, "cloudflared.pid");

export function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(managedFiles.readFile(STATE_FILE, "utf8"));
    }
  } catch (e) { /* ignore corrupt state */ }
  return null;
}

export function saveState(state) {
  managedFiles.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearState() {
  try {
    if (fs.existsSync(STATE_FILE)) managedFiles.unlink(STATE_FILE);
  } catch (e) { /* ignore */ }
}

export function savePid(pid) {
  managedFiles.writeFile(PID_FILE, pid.toString());
}

export function loadPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      return parseInt(managedFiles.readFile(PID_FILE, "utf8"));
    }
  } catch (e) { /* ignore */ }
  return null;
}

export function clearPid() {
  try {
    if (fs.existsSync(PID_FILE)) managedFiles.unlink(PID_FILE);
  } catch (e) { /* ignore */ }
}
