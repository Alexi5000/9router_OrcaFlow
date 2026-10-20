const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");
const path = require("path");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const LINUX_CERT_DIR = "/usr/local/share/ca-certificates";

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
    execFile("certutil", ["-store", "Root", "9Router MITM Root CA"], (error) => {
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
    const child = execFile("sudo", ["-S", "--", file, ...args], error => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin.on("error", reject);
    child.stdin.end(`${password}\n`);
  });
}

async function refreshLinuxTrust(password) {
  try {
    await runElevated("update-ca-certificates", [], password);
  } catch {
    await runElevated("update-ca-trust", [], password);
  }
}

function checkCertInstalledLinux() {
  const certFile = `${LINUX_CERT_DIR}/9router-root-ca.crt`;
  return Promise.resolve(fs.existsSync(certFile));
}

async function installCertLinux(sudoPassword, certPath) {
  const destFile = `${LINUX_CERT_DIR}/9router-root-ca.crt`;

  try {
    await runElevated("cp", ["--", path.resolve(certPath), destFile], sudoPassword);
    await refreshLinuxTrust(sudoPassword);
    console.log("✅ Installed certificate to Linux trust store");
  } catch (error) {
    throw new Error("Certificate install failed");
  }
}

async function uninstallCertLinux(sudoPassword) {
  const destFile = `${LINUX_CERT_DIR}/9router-root-ca.crt`;

  try {
    await runElevated("rm", ["-f", "--", destFile], sudoPassword);
    await refreshLinuxTrust(sudoPassword);
    console.log("✅ Uninstalled certificate from Linux trust store");
  } catch (error) {
    throw new Error("Failed to uninstall certificate");
  }
}

module.exports = { installCert, uninstallCert, checkCertInstalled };
