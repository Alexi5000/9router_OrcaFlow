# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in OrcaFlow, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@techtide.ai**

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Security Design

OrcaFlow is designed with a local-first security model:

- **All data stays local** — Credentials, usage data, and logs are stored only on your machine
- **No telemetry** — No analytics SDKs, tracking pixels, or beacons
- **Cloud sync disabled** — Remote sync features are disabled by default
- **Header masking** — Sensitive headers (Authorization, API keys, tokens) are masked in request logs
- **No tunnel by default** — Cloudflare tunnel feature is disabled

## Best Practices

When running OrcaFlow:

1. **Change the default password** — Update `INITIAL_PASSWORD` in your `.env`
2. **Set a JWT secret** — Configure `JWT_SECRET` instead of using the auto-generated default
3. **Use API keys** — Enable `REQUIRE_API_KEY=true` if exposing the endpoint beyond localhost
4. **Keep `.env` secure** — Never commit your `.env` file (it's gitignored by default)
5. **Review `data/db.json`** — This file contains provider credentials in plaintext; keep it secure

## Upstream Security

For security issues in the core 9Router engine, please also report to the [9Router project](https://github.com/decolua/9router).
