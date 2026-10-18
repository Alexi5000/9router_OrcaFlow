const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, privateEncrypt, constants } = require('node:crypto');
const { readFileSync, existsSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'vendor/node-forge/integrity.json')));
const locations = process.argv.slice(2);
const consumers = locations.length ? locations : ['package.json'];
for (const lockPath of ['pnpm-lock.yaml', 'agents/pnpm-lock.yaml']) {
  const file = path.join(root, lockPath);
  if (existsSync(file)) {
    assert.ok(!/(?<![\w/-])node-forge@[0-9]/.test(readFileSync(file, 'utf8')), `${lockPath}: registry forge copy remains`);
  }
}
for (const lockPath of ['package-lock.json', 'agents/package-lock.json']) {
  const file = path.join(root, lockPath);
  if (existsSync(file)) {
    const lock = JSON.parse(readFileSync(file, 'utf8'));
    for (const [location, metadata] of Object.entries(lock.packages || {})) {
      if (/(^|\/)node_modules\/node-forge$/.test(location)) {
        assert.match(metadata.resolved || '', /^file:.*vendor\/node-forge-1\.4\.0\.tgz$/, `${lockPath}: ${location}`);
      }
    }
  }
}
const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 3 });
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });

for (const consumer of consumers) {
  const load = createRequire(path.join(root, consumer));
  const resolved = load.resolve('node-forge');
  const packageRoot = path.dirname(path.dirname(resolved));
  for (const [file, expected] of Object.entries(manifest)) {
    assert.equal(createHash('sha256').update(readFileSync(path.join(packageRoot, file))).digest('hex'), expected, `${consumer}: ${file}`);
  }
  const forge = load('node-forge');
  const publicKey = forge.pki.publicKeyFromPem(publicPem);
  const privateKey = forge.pki.privateKeyFromPem(privatePem);
  const digest = forge.md.sha256.create().update('backport regression');
  const hash = digest.digest().getBytes();
  assert.equal(publicKey.verify(hash, privateKey.sign(digest)), true);
  const asn1 = forge.asn1;
  const sequence = (children) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, children);
  const oid = () => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(forge.oids.sha256).getBytes());
  const nil = () => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '');
  const octets = (bytes) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, bytes);
  const signature = (algorithm) => {
    const der = Buffer.from(asn1.toDer(sequence([sequence(algorithm), octets(hash)])).getBytes(), 'binary');
    const encoded = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(256 - der.length - 3, 255), Buffer.from([0]), der]);
    return privateEncrypt({ key: keys.privateKey, padding: constants.RSA_NO_PADDING }, encoded).toString('binary');
  };
  for (const algorithm of [[oid()], [oid(), nil()]]) {
    assert.equal(publicKey.verify(hash, signature(algorithm)), true);
  }
  for (const algorithm of [[oid(), nil(), octets('garbage')], [oid(), octets('garbage')], [oid(), nil(), nil()]]) {
    assert.throws(() => publicKey.verify(hash, signature(algorithm)), /valid RSASSA-PKCS1-v1_5/);
  }
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date('2025-01-01');
  certificate.validity.notAfter = new Date('2030-01-01');
  certificate.setSubject([{ name: 'commonName', value: 'backport.invalid' }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.sign(privateKey, forge.md.sha256.create());
  const roundtrip = forge.pki.certificateFromPem(forge.pki.certificateToPem(certificate));
  assert.equal(roundtrip.verify(roundtrip), true);
}
console.log('Forge source integrity, malformed signature rejection, valid signatures and certificate round-trip passed.');
