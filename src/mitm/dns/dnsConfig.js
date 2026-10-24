const { execFile, spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { withPrivateTempDirectory } = require("../privateTemp");

// Per-tool DNS hosts mapping
const { TOOL_HOSTS } = require("../../shared/constants/mitmToolHosts.js");
const { runElevatedPowerShell, isAdmin } = require("../winElevated.js");

function atomicWriteHostsWin(target, originalContent, newContent) {
  const tmpNew = `${target}.9router.new`;
  const tmpBak = `${target}.9router.bak`;
  try {
    fs.writeFileSync(tmpNew, newContent, "utf8");
    try { fs.unlinkSync(tmpBak); } catch { /* none */ }
    fs.renameSync(target, tmpBak);
    try {
      fs.renameSync(tmpNew, target);
    } catch (e) {
      // Rollback: restore original
      try { fs.renameSync(tmpBak, target); } catch { fs.writeFileSync(target, originalContent, "utf8"); }
      throw e;
    }
    try { fs.unlinkSync(tmpBak); } catch { /* best effort */ }
  } finally {
    try { fs.unlinkSync(tmpNew); } catch { /* already moved or never created */ }
  }
}

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

/**
 * Execute elevated PowerShell script on Windows via Start-Process -Verb RunAs.
 * Only UAC consent dialog appears, no CMD/PS window popup.
 */
async function executeElevatedPowerShell(script, timeoutMs = 30000) {
  return withPrivateTempDirectory(async (temp) => {
    const flagFile = temp.write("complete.flag", "");
    const psSQ = (s) => s.replace(/'/g, "''");
    const psContent = typeof script === "function" ? script(temp) : script;
    const psScriptPath = temp.write("command.ps1", psContent +
      `\nSet-Content -LiteralPath '${psSQ(flagFile)}' -Value 'done' -Encoding UTF8\n`);
    const outerCmd = `Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','"${psSQ(psScriptPath)}"' -Verb RunAs -WindowStyle Hidden`;

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const settle = (fn, arg) => {
        if (!settled) { settled = true; clearTimeout(timer); fn(arg); }
      };
      execFile(
        "powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", outerCmd],
        { windowsHide: true },
        (error) => { if (error) settle(reject, new Error("PowerShell elevation failed")); }
      );
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        if (settled) return;
        try {
          if (fs.readFileSync(flagFile, "utf8").trim() === "done") return settle(resolve);
        } catch (error) {
          return settle(reject, error);
        }
        if (Date.now() > deadline) return settle(reject, new Error("Timed out waiting for UAC confirmation"));
        timer = setTimeout(poll, 500);
      };
      if (!settled) timer = setTimeout(poll, 300);
    });
  });
}

/**
 * Execute command with sudo password via stdin (macOS/Linux only)
 */
function isSudoAvailable() {
  if (IS_WIN) return false;
  try {
    execSync("command -v sudo", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function canRunSudoWithoutPassword() {
  if (IS_WIN || !isSudoAvailable()) return true;
  try {
    execSync("sudo -n true", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function isSudoPasswordRequired() {
  return !IS_WIN && isSudoAvailable() && !canRunSudoWithoutPassword();
}


function execWithPassword(command, password) {
  return new Promise((resolve, reject) => {
    const useSudo = isSudoAvailable();
    const child = useSudo
      ? spawn("sudo", ["-S", "sh", "-c", command], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      : spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });

    child.on("error", reject);
    if (useSudo) { child.stdin.on("error", reject); child.stdin.end(`${password}\n`); }
  });
}

/**
 * Flush DNS cache (macOS/Linux)
 */
async function flushDNS(sudoPassword) {
  if (IS_WIN) return; // Windows flushes inline via ipconfig
  if (IS_MAC) {
    await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
  } else {
    await execWithPassword("resolvectl flush-caches 2>/dev/null || true", sudoPassword);
  }
}

/**
 * Check if DNS entry exists for a specific host
 */
function checkDNSEntry(host = null) {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    if (host) return hostsContent.includes(host);
    // Legacy: check all antigravity hosts (backward compat)
    return TOOL_HOSTS.antigravity.every(h => hostsContent.includes(h));
  } catch {
    return false;
  }
}

/**
 * Check DNS status per tool — returns { [tool]: boolean }
 */
function checkAllDNSStatus() {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    const result = {};
    for (const [tool, hosts] of Object.entries(TOOL_HOSTS)) {
      result[tool] = hosts.every(h => hostsContent.includes(h));
    }
    return result;
  } catch {
    return Object.fromEntries(Object.keys(TOOL_HOSTS).map(t => [t, false]));
  }
}

/**
 * Add DNS entries for a specific tool
 */
async function addDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToAdd = hosts.filter(h => !checkDNSEntry(h));
  if (entriesToAdd.length === 0) {
    console.log(`DNS entries for ${tool} already exist`);
    return;
  }

  const entries = entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\n");

  try {
    if (IS_WIN && isAdmin()) {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const next = current.trimEnd() + "\r\n" + entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\r\n") + "\r\n";
      atomicWriteHostsWin(HOSTS_FILE, current, next);
      await runElevatedPowerShell("ipconfig /flushdns | Out-Null");
    } else if (IS_WIN) {
      const hostsPath = HOSTS_FILE.replace(/'/g, "''");
      
      // Build PowerShell script with proper error handling
      const scriptLines = [];
      scriptLines.push(`$ErrorActionPreference = 'Stop'`);
      scriptLines.push(`$hostsPath = '${hostsPath}'`);
      scriptLines.push(`try {`);
      scriptLines.push(`  $hostsContent = Get-Content -Path $hostsPath -Raw -ErrorAction SilentlyContinue`);
      scriptLines.push(`  if (-not $hostsContent) { $hostsContent = '' }`);
      
      for (const host of entriesToAdd) {
        // Escape special regex chars in hostname
        const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        scriptLines.push(`  if ($hostsContent -notmatch '${escapedHost}') {`);
        scriptLines.push(`    Add-Content -Path $hostsPath -Value '127.0.0.1 ${host}' -Encoding UTF8 -ErrorAction Stop`);
        scriptLines.push(`    Write-Host "Added DNS entry: ${host}"`);
        scriptLines.push(`  } else {`);
        scriptLines.push(`    Write-Host "DNS entry already exists: ${host}"`);
        scriptLines.push(`  }`);
      }
      
      scriptLines.push(`  ipconfig /flushdns | Out-Null`);
      scriptLines.push(`} catch {`);
      scriptLines.push(`  Write-Error "Failed to add DNS: $_"`);
      scriptLines.push(`  exit 1`);
      scriptLines.push(`}`);
      
      const psScript = scriptLines.join("\n");
      await executeElevatedPowerShell(psScript, 30000);
    } else {
      await execWithPassword(`echo "${entries}" >> ${HOSTS_FILE}`, sudoPassword);
      await flushDNS(sudoPassword);
    }
    console.log(`✅ Added DNS entries for ${tool}: ${entriesToAdd.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : "Failed to add DNS entry";
    throw new Error(msg);
  }
}

/**
 * Remove DNS entries for a specific tool
 */
async function removeDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToRemove = hosts.filter(h => checkDNSEntry(h));
  if (entriesToRemove.length === 0) {
    console.log(`DNS entries for ${tool} do not exist`);
    return;
  }

  try {
    if (IS_WIN && isAdmin()) {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const next = current.split(/\r?\n/).filter(line => !entriesToRemove.some(host => line.includes(host))).join("\r\n").trimEnd() + "\r\n";
      atomicWriteHostsWin(HOSTS_FILE, current, next);
      await runElevatedPowerShell("ipconfig /flushdns | Out-Null");
    } else if (IS_WIN) {
      const content = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = content.split(/\r?\n/).filter(l => !entriesToRemove.some(h => l.includes(h))).join("\r\n");
      await executeElevatedPowerShell((temp) => {
        const tmpFile = temp.write("hosts.tmp", filtered);
      
        const tmpEsc = tmpFile.replace(/'/g, "''");
        const hostsEsc = HOSTS_FILE.replace(/'/g, "''");
      
        // Build PowerShell script with proper error handling
        const scriptLines = [];
        scriptLines.push(`$ErrorActionPreference = 'Stop'`);
        scriptLines.push(`try {`);
        scriptLines.push(`  Copy-Item -Path '${tmpEsc}' -Destination '${hostsEsc}' -Force -ErrorAction Stop`);
        scriptLines.push(`  Write-Host "Hosts file updated successfully"`);
        scriptLines.push(`  ipconfig /flushdns | Out-Null`);
        scriptLines.push(`  Write-Host "DNS cache flushed"`);
        scriptLines.push(`  Remove-Item '${tmpEsc}' -ErrorAction SilentlyContinue`);
        scriptLines.push(`} catch {`);
        scriptLines.push(`  Write-Error "Failed to remove DNS: $_"`);
        scriptLines.push(`  Remove-Item '${tmpEsc}' -ErrorAction SilentlyContinue`);
        scriptLines.push(`  exit 1`);
        scriptLines.push(`}`);
      
        return scriptLines.join("\n");
      }, 30000);
    } else {
      for (const host of entriesToRemove) {
        const sedCmd = IS_MAC
          ? `sed -i '' '/${host}/d' ${HOSTS_FILE}`
          : `sed -i '/${host}/d' ${HOSTS_FILE}`;
        await execWithPassword(sedCmd, sudoPassword);
      }
      await flushDNS(sudoPassword);
    }
    console.log(`✅ Removed DNS entries for ${tool}: ${entriesToRemove.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : "Failed to remove DNS entry";
    throw new Error(msg);
  }
}

/**
 * Remove ALL tool DNS entries (used when stopping server)
 */
async function removeAllDNSEntries(sudoPassword) {
  for (const tool of Object.keys(TOOL_HOSTS)) {
    try {
      await removeDNSEntry(tool, sudoPassword);
    } catch (e) {
      console.log(`[MITM] Warning: failed to remove DNS for ${tool}: ${e.message}`);
    }
  }
}

function removeAllDNSEntriesSync() {
  try {
    const allHosts = Object.values(TOOL_HOSTS).flat();
    const fd = fs.openSync(HOSTS_FILE, fs.constants.O_RDWR | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
    try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("Invalid hosts file");
    const content = fs.readFileSync(fd, "utf8");
    const eol = IS_WIN ? "\r\n" : "\n";
    const filtered = content.split(/\r?\n/).filter(l => !allHosts.some(h => l.includes(h))).join(eol);
    const next = filtered.replace(/[\r\n\s]+$/g, "") + eol;
    if (next === content) return;
    fs.writeSync(fd, next, 0, "utf8");
    fs.ftruncateSync(fd, Buffer.byteLength(next));
    } finally { fs.closeSync(fd); }
    if (IS_WIN) {
      try { execSync("ipconfig /flushdns", { windowsHide: true, stdio: "ignore" }); } catch { /* ignore */ }
    } else if (IS_MAC) {
      try { execSync("dscacheutil -flushcache && killall -HUP mDNSResponder", { stdio: "ignore" }); } catch { /* ignore */ }
    } else {
      try { execSync("resolvectl flush-caches 2>/dev/null || true", { stdio: "ignore" }); } catch { /* ignore */ }
    }
  } catch { /* best effort during shutdown */ }
}

module.exports = {
  removeAllDNSEntriesSync,
  isSudoAvailable,
  canRunSudoWithoutPassword,
  isSudoPasswordRequired,
  TOOL_HOSTS,
  addDNSEntry,
  removeDNSEntry,
  removeAllDNSEntries,
  execWithPassword,
  executeElevatedPowerShell,
  checkDNSEntry,
  checkAllDNSStatus,
};
