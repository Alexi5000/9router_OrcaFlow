const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");
const path = require("path");
const os = require("os");
const { isSudoAvailable } = require("../dns/dnsConfig.js");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const LINUX_CERT_PATHS = [
  // Debian / Ubuntu
  { dir: "/usr/local/share/ca-certificates", cmd: "update-ca-certificates" },
  // Arch Linux / CachyOS / Manjaro
  { dir: "/etc/ca-certificates/trust-source/anchors", cmd: "update-ca-trust" },
  // Fedora / RHEL / CentOS
  { dir: "/etc/pki/ca-trust/source/anchors", cmd: "update-ca-trust" },
  // openSUSE
  { dir: "/etc/pki/trust/anchors", cmd: "update-ca-certificates" }
];

function getLinuxCertConfig() {
  for (const config of LINUX_CERT_PATHS) {
    if (fs.existsSync(config.dir)) {
      return config;
    }
  }
  // Fallback to Debian default if none exist
  return LINUX_CERT_PATHS[0];
}
const ROOT_CA_CN = "9Router MITM Root CA";

// Get SHA1 fingerprint from cert file using Node.js crypto
function getCertFingerprint(certPath) {
  const pem = fs.readFileSync(certPath, "utf-8");
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");
  return crypto.createHash("sha1").update(der).digest("hex").toUpperCase().match(/.{2}/g).join(":");
}

/**
 * Check if certificate is already installed in system store
 */
async function checkCertInstalled(certPath) {
  if (IS_WIN) return checkCertInstalledWindows(certPath);
  if (IS_MAC) return checkCertInstalledMac(certPath);
  return checkCertInstalledLinux();
}

function checkCertInstalledMac(certPath) {
  return new Promise((resolve) => {
    try {
      const fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
      // security verify-cert returns 0 only if cert is trusted by system policy
      execFile("security", ["verify-cert", "-c", path.resolve(certPath), "-p", "ssl", "-k", "/Library/Keychains/System.keychain"], (error) => {
        if (!error) return resolve(true);
        // Fallback: check if fingerprint appears in System keychain with trust
        execFile("security", ["dump-trust-settings", "-d"], (err2, stdout2) => {
          resolve(!err2 && !!stdout2?.toUpperCase().includes(fingerprint));
        });
      });
    } catch {
      resolve(false);
    }
  });
}

function checkCertInstalledWindows(certPath) {
  return new Promise((resolve) => {
    // Check Root store for our Root CA by common name
    let fingerprint;
    try { fingerprint = getCertFingerprint(certPath).replace(/:/g, ""); } catch { return resolve(false); }
    execFile("certutil", ["-store", "Root", fingerprint], (error) => {
      resolve(!error);
    });
  });
}

/**
 * Install SSL certificate to system trust store
 */
async function installCert(sudoPassword, certPath) {
  if (!fs.existsSync(certPath)) {
    throw new Error(`Certificate file not found: ${certPath}`);
  }

  const isInstalled = await checkCertInstalled(certPath);
  if (isInstalled) {
    if (!IS_WIN && !IS_MAC) await refreshLinuxTrust(sudoPassword);
    console.log("✅ Certificate already installed");
    return;
  }

  if (IS_WIN) {
    await installCertWindows(certPath);
  } else if (IS_MAC) {
    await installCertMac(sudoPassword, certPath);
  } else {
    await installCertLinux(sudoPassword, certPath);
  }
}

async function installCertMac(sudoPassword, certPath) {
  const args = ["add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain", path.resolve(certPath)];
  try {
    await runElevated("security", args, sudoPassword);
    console.log(`✅ Installed certificate to system keychain: ${certPath}`);
  } catch (error) {
    const msg = error.message?.includes("canceled") ? "User canceled authorization" : "Certificate install failed";
    throw new Error(msg);
  }
}

async function installCertWindows(certPath) {
  await runWindowsCertutil(["-addstore", "Root", path.resolve(certPath)]);
  console.log("✅ Installed certificate to Windows Root store");
}

/**
 * Uninstall SSL certificate from system store
 */
async function uninstallCert(sudoPassword, certPath) {
  const isInstalled = await checkCertInstalled(certPath);
  if (!isInstalled) {
    console.log("Certificate not found in system store");
    return;
  }

  if (IS_WIN) {
    await uninstallCertWindows();
  } else if (IS_MAC) {
    await uninstallCertMac(sudoPassword, certPath);
  } else {
    await uninstallCertLinux(sudoPassword);
  }
}

async function uninstallCertMac(sudoPassword, certPath) {
  const fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
  const args = ["delete-certificate", "-Z", fingerprint, "/Library/Keychains/System.keychain"];
  try {
    await runElevated("security", args, sudoPassword);
    console.log("✅ Uninstalled certificate from system keychain");
  } catch (err) {
    throw new Error("Failed to uninstall certificate");
  }
}

async function uninstallCertWindows() {
  await runWindowsCertutil(["-delstore", "Root", "9Router MITM Root CA"]);
  console.log("✅ Uninstalled certificate from Windows Root store");
}

function runWindowsCertutil(args) {
  const literal = value => "'" + value.replace(/'/g, "''") + "'";
  const script = "& certutil " + args.map(literal).join(" ") + "; exit $LASTEXITCODE";
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const outer = `$ErrorActionPreference = 'Stop'; $child = Start-Process powershell -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $child.ExitCode`;
  return new Promise((resolve, reject) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", outer], { windowsHide: true }, error => {
      if (error) reject(new Error("Certificate trust-store update failed"));
      else resolve();
    });
  });
}

function runElevated(file, args, password) {
  return new Promise((resolve, reject) => {
    const useSudo = typeof isSudoAvailable !== "function" || isSudoAvailable();
    const child = execFile(useSudo ? "sudo" : file, useSudo ? ["-S", "--", file, ...args] : args, error => {
      if (error) reject(error);
      else resolve();
    });
    if (useSudo) { child.stdin.on("error", reject); child.stdin.end(`${password}\n`); }
  });
}

async function refreshLinuxTrust(password) {
  const command = getLinuxCertConfig().cmd;
  try { await runElevated(command, [], password); } catch (error) {
    if (command !== "update-ca-certificates") throw error;
    await runElevated("update-ca-trust", [], password);
  }
}

function checkCertInstalledLinux() {
  const config = getLinuxCertConfig();
  const certFile = `${config.dir}/9router-root-ca.crt`;
  return Promise.resolve(fs.existsSync(certFile));
}

async function updateNssDatabases(certPath, action = "add") {
  const home = os.homedir();
  const dirs = [path.join(home, ".pki/nssdb"), path.join(home, "snap/chromium/current/.pki/nssdb")];
  for (const root of [path.join(home, ".mozilla/firefox"), path.join(home, "snap/firefox/common/.mozilla/firefox")]) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const dir = path.join(root, entry.name);
        if (entry.isDirectory() && (fs.existsSync(path.join(dir, "cert9.db")) || fs.existsSync(path.join(dir, "cert8.db")))) dirs.push(dir);
      }
    } catch {}
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const args = action === "add" ? ["-A", "-t", "C,,", "-n", ROOT_CA_CN, "-i", path.resolve(certPath)] : ["-D", "-n", ROOT_CA_CN];
    for (const database of [`sql:${dir}`, dir]) {
      const ok = await new Promise(resolve => execFile("certutil", ["-d", database, ...args], { timeout: 30000 }, error => resolve(!error)));
      if (ok) break;
    }
  }
}

async function installCertLinux(sudoPassword, certPath) {
  if (typeof isSudoAvailable === "function" && !isSudoAvailable() && process.getuid?.() !== 0) {
    await updateNssDatabases(certPath, "add");
    console.log(`System trust unchanged: install this certificate as administrator: ${certPath}`);
    return;
  }
  const destFile = `${getLinuxCertConfig().dir}/9router-root-ca.crt`;

  try {
    await runElevated("cp", ["--", path.resolve(certPath), destFile], sudoPassword);
    await refreshLinuxTrust(sudoPassword);
    await updateNssDatabases(certPath, "add");
    console.log("✅ Installed certificate to Linux trust store");
  } catch (error) {
    throw new Error(`Certificate install failed: ${error.message}`);
  }
}

async function uninstallCertLinux(sudoPassword) {
  await updateNssDatabases(null, "delete");
  if (typeof isSudoAvailable === "function" && !isSudoAvailable() && process.getuid?.() !== 0) return;
  const destFile = `${getLinuxCertConfig().dir}/9router-root-ca.crt`;

  try {
    await runElevated("rm", ["-f", "--", destFile], sudoPassword);
    await refreshLinuxTrust(sudoPassword);
    console.log("✅ Uninstalled certificate from Linux trust store");
  } catch (error) {
    throw new Error("Failed to uninstall certificate");
  }
}

module.exports = { installCert, uninstallCert, checkCertInstalled };
