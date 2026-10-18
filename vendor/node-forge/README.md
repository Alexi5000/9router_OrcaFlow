# node-forge security backport

Package identity remains node-forge 1.4.0. The archive contains upstream v1.4.0 with only the lib/rsa.js change proposed in https://github.com/digitalbazaar/forge/pull/1152 at ceba34402e329f0365134f23fe19898756527d65. This contribution is not yet an upstream release or merged fix. Licenses are retained in the archive.

Addresses GHSA-86w9-cpqp-85rv by rejecting extra children in nested DigestAlgorithm structures. Registry audits can still flag this version; do not dismiss alerts or claim a clean raw audit. Replace this backport with a verified upstream release when available.

The upstream regression fails on unmodified 1.4.0 and passes with the patch. The upstream Node suite passes 829 tests, with four pre-existing pending tests, after removing the upstream jsbn describe.only marker in the verification checkout. No test marker changes enter the distributed package.

scripts/verify-forge.cjs checks every installed library source hash, rejects three malformed signature variants, accepts SHA256 signatures with and without NULL parameters, and signs/verifies a certificate through its PEM round trip. Run it during builds so unpatched copies fail verification.
