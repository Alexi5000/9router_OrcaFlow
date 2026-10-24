const path = require("path");
const fs = require("fs");
const forge = require("node-forge");
const { randomBytes } = require("crypto");
const { MITM_DIR } = require("../paths");

const ROOT_CA_KEY_PATH = path.join(MITM_DIR, "rootCA.key");
const ROOT_CA_CERT_PATH = path.join(MITM_DIR, "rootCA.crt");

function readCertificateFile(filePath) {
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    const current = fs.lstatSync(filePath);
    if (!opened.isFile() || opened.nlink !== 1 || current.isSymbolicLink()
      || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new Error("Root CA must use regular, unlinked files");
    }
    if (filePath === ROOT_CA_KEY_PATH && process.platform !== "win32") {
      fs.fchmodSync(fd, 0o600);
    }
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function validateCertificateDirectory() {
  const directory = fs.lstatSync(MITM_DIR);
  if (!directory.isDirectory() || directory.isSymbolicLink()
    || (process.platform !== "win32" && ((directory.mode & 0o022) !== 0 || directory.uid !== process.getuid()))) {
    throw new Error("Root CA directory must be owned by the current user and not writable by other users");
  }
}

/**
 * Check if cert file is expired or expiring within 30 days
 */
function isCertExpired(certPath) {
  try {
    const cert = forge.pki.certificateFromPem(readCertificateFile(certPath));
    const expiryThreshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return cert.validity.notAfter < expiryThreshold;
  } catch {
    return true; // treat unreadable cert as expired
  }
}

/**
 * Generate Root CA certificate (only once; expired pairs require explicit trusted rotation)
 * This Root CA will sign all dynamic leaf certificates
 */
async function generateRootCA() {
  fs.mkdirSync(MITM_DIR, { recursive: true, mode: 0o700 });
  validateCertificateDirectory();
  let existingKey;
  let existingCert;
  for (const filePath of [ROOT_CA_KEY_PATH, ROOT_CA_CERT_PATH]) {
    try {
      const pem = readCertificateFile(filePath);
      if (filePath === ROOT_CA_KEY_PATH) existingKey = pem;
      else existingCert = pem;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (existingKey !== undefined || existingCert !== undefined) {
    if (existingKey === undefined || existingCert === undefined) {
      throw new Error("Incomplete Root CA pair; restore the missing file before retrying");
    }
    const key = forge.pki.privateKeyFromPem(existingKey);
    const cert = forge.pki.certificateFromPem(existingCert);
    if (key.n.compareTo(cert.publicKey.n) !== 0 || key.e.compareTo(cert.publicKey.e) !== 0) {
      throw new Error("Root CA key and certificate do not match");
    }
    if (cert.validity.notAfter <= new Date()) throw new Error("Root CA expired; rotate the trusted certificate pair before retrying");
    console.log("✅ Root CA already exists");
    return { key: ROOT_CA_KEY_PATH, cert: ROOT_CA_CERT_PATH };
  }

  console.log("🔐 Generating Root CA certificate...");

  // Generate RSA key pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create Root CA certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: "commonName", value: "9Router MITM Root CA" },
    { name: "organizationName", value: "9Router" },
    { name: "countryName", value: "US" }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs); // Self-signed

  cert.setExtensions([
    {
      name: "basicConstraints",
      cA: true,
      critical: true
    },
    {
      name: "keyUsage",
      keyCertSign: true,
      cRLSign: true,
      critical: true
    },
    {
      name: "subjectKeyIdentifier"
    }
  ]);

  // Self-sign the certificate
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Save to disk
  const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);

  fs.writeFileSync(ROOT_CA_KEY_PATH, privateKeyPem, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(ROOT_CA_CERT_PATH, certPem, { flag: "wx", mode: 0o600 });

  console.log("✅ Root CA generated successfully");
  return { key: ROOT_CA_KEY_PATH, cert: ROOT_CA_CERT_PATH };
}

/**
 * Load Root CA from disk
 */
function loadRootCA() {
  validateCertificateDirectory();
  const keyPem = readCertificateFile(ROOT_CA_KEY_PATH);
  const certPem = readCertificateFile(ROOT_CA_CERT_PATH);

  return {
    key: forge.pki.privateKeyFromPem(keyPem),
    cert: forge.pki.certificateFromPem(certPem)
  };
}

/**
 * Generate leaf certificate for a specific domain, signed by Root CA
 */
function generateLeafCert(domain, rootCA) {
  // Generate key pair for leaf cert
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create leaf certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${randomBytes(15).toString("hex")}`;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  cert.setSubject([
    { name: "commonName", value: domain }
  ]);

  cert.setIssuer(rootCA.cert.subject.attributes);

  cert.setExtensions([
    {
      name: "basicConstraints",
      cA: false
    },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
      clientAuth: true
    },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: domain }, // DNS
        { type: 2, value: `*.${domain}` } // Wildcard
      ]
    }
  ]);

  // Sign with Root CA
  cert.sign(rootCA.key, forge.md.sha256.create());

  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert)
  };
}

module.exports = {
  generateRootCA,
  loadRootCA,
  generateLeafCert,
  isCertExpired,
  ROOT_CA_CERT_PATH,
  ROOT_CA_KEY_PATH
};
