<div align="center">

# OrcaFlow

### AI Router by TechTide AI

**One endpoint for all your AI providers. Smart fallback, auto-routing, zero downtime.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Based on 9Router](https://img.shields.io/badge/Based%20on-9Router-orange)](https://github.com/decolua/9router)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<br/>

[Features](#key-features) &bull; [Quick Start](#quick-start) &bull; [Providers](#supported-providers) &bull; [Configuration](#configuration) &bull; [Contributing](CONTRIBUTING.md)

</div>

---

## Why this fork exists

**What it does.** OrcaFlow is a local AI proxy/router that sits between coding tools (Claude Code, Codex, Cursor, Cline and others) and AI providers. It exposes one endpoint (`http://localhost:20128/v1`), translates between the OpenAI, Claude and Gemini request formats, falls back across subscription, cheap and free provider tiers, round-robins multiple accounts per provider, refreshes OAuth tokens, and records usage locally in a JSON database.

**Who it serves.** Developers and small teams who run several AI coding CLIs against several providers and want one self-hosted endpoint on their own machine or server, with provider credentials and usage data kept local.

**Why Alex forked it.** The fork was created on 2026-03-11 (GitHub API `created_at` 2026-03-11T03:08:35Z). The first fork-only commit (`f209efbb`, 2026-03-10 -0400, "feat: OrcaFlow rebrand", subject continues "TechTide AI fork of 9Router") records the initial intent: "Rebrand all UI from 'Orca Router' / '9Router' to 'OrcaFlow'", "Re-enable maskSensitiveHeaders() in request logger (security fix)" and "Include TechTide local customizations (providers, themes, SSE handlers)". The unmerged `techtide/build-out` branch (commit `6d61d5a6`, 2026-05-21, "docs: add TechTide backstory") states the operating reason: "TechTide deploys LLM tooling for field engineers working on-site behind restrictive corporate firewalls. A single, self-hosted proxy that handles provider selection, failover, and auth simplifies operations dramatically compared to managing multiple API keys and provider-specific SDKs per client site." In October 2026 the fork received 24 merged pull requests (#1 to #24) of dependency and security fixes: MITM command boundaries, management API authentication, SSRF guards and credential entropy.

**Real-world use case (2025–2026 evidence).** **Verified in this repository.** An operator runs OrcaFlow under pm2 (`ecosystem.config.cjs`, `scripts/redeploy-production.cjs`) on a workstation, then points Claude Code at it with `ANTHROPIC_BASE_URL=http://localhost:20128` and Codex CLI at it through a custom `[model_providers.<id>]` block with `base_url = "http://localhost:20128/v1"`, so both tools share one credential set and one fallback chain (for example the `deepseek-code` combo whose direct, mirrored and paid tiers are asserted by `tests/deployment/deepseek-route-config.test.js` against the live `data/db.json`). This is the pattern the CLI vendors document: Codex CLI resolves providers from `config.toml` and routes Chat Completions-only backends through a translation proxy[^1]; LiteLLM's October 2026 releases add gateway support for running Claude Code, Codex and OpenCode behind one proxy[^2]; Claude Code itself added a `fallbackModel` setting for up to three ordered fallbacks in June 2026, showing demand for client-side failover that a router centralizes[^3]; and the upstream 9Router changelog (v0.5.104, 2026-10-15) keeps shipping provider, quota and CLI-tool integrations for exactly this proxy role[^4].

[^1]: Daniel Vaughan, "Codex CLI Custom Model Providers: The Complete Configuration Guide", https://codex.danielvaughan.com/2026/04/23/codex-cli-custom-model-providers-configuration-guide (published 2026-04-23, updated 2026-10-20).
[^2]: LiteLLM, "Changelog" (v1.105.0, 2026-10-11: "`litellm.agent()` runs Claude Code, Codex, OpenCode and Deep Agents through the AI gateway"; v1.103.2, 2026-10-01: Claude Code auto mode through the gateway), https://docs.litellm.ai/release_notes (fetched 2026-10-20).
[^3]: Anthropic, "What's new - Claude Code Docs", Week 24 (June 8–12, 2026): "`fallbackModel` configures up to three fallback models tried in order", https://code.claude.com/docs/en/whats-new (fetched 2026-10-20).
[^4]: decolua/9router, CHANGELOG.md, v0.5.104 (2026-10-15), https://github.com/decolua/9router/blob/master/CHANGELOG.md (fetched 2026-10-20).

```
Your CLI Tool (Claude Code, Codex, Cursor, Cline...)
        |
        v
   OrcaFlow (localhost:20128)
   - Format translation
   - Quota tracking
   - Auto token refresh
        |
        +---> Subscription tier (Claude Code, Codex, Gemini CLI)
        +---> Cheap tier (GLM, MiniMax, Kimi)
        +---> Free tier (iFlow, Qwen, Kiro)
```

---

## Upstream

**OrcaFlow is a customized fork of [9Router](https://github.com/decolua/9router)** by [decolua](https://github.com/decolua) and contributors. All credit for the core routing engine, provider integrations, format translation layer and architecture goes to the 9Router team.

| | |
|---|---|
| **Original Project** | [github.com/decolua/9router](https://github.com/decolua/9router) |
| **9Router Website** | [9router.com](https://9router.com) |
| **Upstream License** | MIT, preserved in this fork (`LICENSE` keeps the original copyright notice) |
| **Contributors** | [View all contributors](https://github.com/decolua/9router/graphs/contributors) |
| **Fork date** | 2026-03-11 |
| **Fork default branch** | `orcaflow` (upstream default: `master`) |

**What changed in this fork** (from `gh api compare decolua:master...Alexi5000:orcaflow`, 2026-10-20): the fork is **268 commits ahead and 1,366 commits behind** upstream `master` (status: diverged). The fork tracks 9Router 0.3.x (`package.json` version 0.3.54) while upstream is at 0.5.104, so upstream features added after March 2026 are not in this fork.

| Change | Evidence |
|--------|----------|
| **OrcaFlow branding** | UI, package name and GitHub links rebranded (`f209efbb`) |
| **Header masking re-enabled** | `maskSensitiveHeaders()` applied in `open-sse/utils/requestLogger.js` |
| **Cloud sync not wired in** | `src/shared/services/initializeCloudSync.js` and `cloudSyncScheduler.js` are not imported by app initialization |
| **Tunnel off by default** | `tunnelEnabled: false` in `src/lib/localDb.js` defaults |
| **Security hardening (Oct 2026)** | 24 merged PRs: management API session auth, MITM command and TLS boundaries, SSRF guards on provider validation, cryptographic API key entropy, OAuth callback state binding, settings validation |
| **Patched vendored dependencies** | `vendor/braces-3.0.3.tgz` and `vendor/node-forge-1.4.0.tgz` pinned through `pnpm.overrides`, verified by `scripts/verify-braces.cjs` and `scripts/verify-forge.cjs` at build time |
| **CI** | `.github/workflows/dependency-validation.yml` runs unit and security tests plus a container build on every push to `orcaflow` |
| **Tests** | `tests/unit/*` (vitest), `tests/security/*.cjs` (node:test), `tests/deployment/*` (live config gate) |

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Smart 3-Tier Fallback** | Auto-route: Subscription &rarr; Cheap &rarr; Free |
| **Real-Time Quota Tracking** | Live token count + reset countdown |
| **Format Translation** | OpenAI &harr; Claude &harr; Gemini seamless |
| **Multi-Account Support** | Multiple accounts per provider with round-robin |
| **Auto Token Refresh** | OAuth tokens refresh automatically |
| **Custom Combos** | Create unlimited model combinations |
| **Usage Analytics** | Track tokens, cost, trends locally |
| **MITM Proxy** | Intercept CLI tool traffic for transparent routing |

---

## Quick Start

### From source (recommended)

```bash
git clone https://github.com/Alexi5000/9router_OrcaFlow.git
cd 9router_OrcaFlow
cp .env.example .env
pnpm install --frozen-lockfile
pnpm run dev
```

The repository ships a `pnpm-lock.yaml` and CI installs with pnpm 10. Set `JWT_SECRET` (at least 32 random characters) and `INITIAL_PASSWORD` in `.env` before the first login; see [Configuration](#configuration).

Dashboard opens at `http://localhost:20128`

### Production mode

```bash
pnpm run build
PORT=20128 pnpm run start
```

`pnpm run build` runs `scripts/verify-braces.cjs` and `scripts/verify-forge.cjs` before `next build` to confirm the patched vendored dependencies are the ones installed.

---

## Supported CLI Tools

Works with all major AI coding tools:

| Tool | Status |
|------|--------|
| Claude Code | Fully supported |
| OpenAI Codex | Fully supported |
| Cursor | Fully supported |
| Cline / RooCode | Fully supported |
| Continue | Fully supported |
| GitHub Copilot | Fully supported |
| OpenClaw | Fully supported |
| Gemini CLI | Fully supported |

**Configuration** (same for all tools):
```
Endpoint: http://localhost:20128/v1
API Key:  [copy from OrcaFlow dashboard]
Model:    cc/claude-opus-4-6  (or any supported model)
```

---

## Supported Providers

### OAuth Providers (Free login)

| Provider | Models | Quota |
|----------|--------|-------|
| Claude Code | Opus, Sonnet, Haiku | 5h + weekly reset |
| OpenAI Codex | GPT-5.2, GPT-5.1 | 5h + weekly reset |
| Gemini CLI | Gemini 3 Flash, 2.5 Pro | 180K/month FREE |
| GitHub Copilot | GPT-5, Claude 4.5 | Monthly reset |
| Cursor | Various | Per subscription |

### Free Providers (Unlimited)

| Provider | Models | Cost |
|----------|--------|------|
| iFlow AI | 8+ models (Kimi K2, Qwen, GLM, DeepSeek) | $0 |
| Qwen Code | Qwen 3 Coder Plus/Flash | $0 |
| Kiro AI | Claude Sonnet/Haiku | $0 |

### API Key Providers (40+)

OpenRouter, GLM, Kimi, MiniMax, OpenAI, Anthropic, Gemini, DeepSeek, Groq, xAI, Mistral, Perplexity, Together AI, Fireworks, Cerebras, Cohere, NVIDIA, SiliconFlow, and 20+ more.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `20128` | Service port |
| `JWT_SECRET` | (required) | JWT signing secret, at least 32 random characters; startup fails closed without it |
| `INITIAL_PASSWORD` | (required for first login) | First login password; the old `123456` fallback is no longer accepted |
| `REQUIRE_API_KEY` | `false` | Enforce Bearer API key on `/v1/*` routes |
| `ENABLE_REQUEST_LOGS` | `false` | Enable request/response logs |
| `OBSERVABILITY_ENABLED` | `true` | Local usage tracking |

See `.env.example` for all available variables.

Provider validation accepts public HTTP(S) endpoints and rejects redirects and private network destinations. To validate a trusted local or self-hosted provider, set `PROVIDER_VALIDATION_ALLOWED_ORIGINS` on the server to exact comma-separated origins, including ports, for example `http://localhost:11434,http://192.168.1.20:8000`, then restart the service. Only list origins you trust to receive provider API keys. Request bodies cannot override this setting. TLS certificate verification stays enabled.

### Management API authentication

When login is enabled (the default), dashboard pages and management APIs require the same authenticated session. This includes settings, provider credentials, CLI configuration, OAuth initiation/exchange, and shutdown. Provider OAuth callbacks continue to use their existing browser/local callback flows; authenticated dashboard requests initiate and exchange them. Public inference protocol routes under `/api/v1` and `/api/v1beta` retain their existing API-key handling, independently of dashboard sessions. Login/logout, version, tags, and the login-required indicator remain public.

Configure `JWT_SECRET` with at least 32 random characters and `INITIAL_PASSWORD` before the first login, or use an existing stored password hash. Public default signing secrets and the old `123456` fallback password are no longer accepted. Missing configuration fails closed; existing sessions signed with a valid configured secret remain usable. Intentionally setting `requireLogin: false` preserves local no-login operation, and must not be used on an exposed service. Cross-origin management writes are rejected. Live deployment and provider validation remain separate mandatory checks.

---

## API Reference

### Chat Completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true
}
```

### Compatibility Endpoints

| Endpoint | Format |
|----------|--------|
| `POST /v1/chat/completions` | OpenAI format |
| `POST /v1/messages` | Anthropic format |
| `POST /v1/responses` | OpenAI Responses format |
| `GET /v1/models` | List all models |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Runtime** | Node.js 20+ |
| **Framework** | Next.js 16 |
| **UI** | React 19 + Tailwind CSS 4 |
| **Database** | LowDB (JSON file-based, local only) |
| **Streaming** | Server-Sent Events (SSE) |
| **Auth** | OAuth 2.0 (PKCE) + JWT + API Keys |

---

## Testing

```bash
pnpm run test:unit          # offline vitest suite in tests/unit
node --test tests/security/private-elevation.test.cjs tests/security/windows-server-start.test.cjs
pnpm run test:deployment    # validates the real data/db.json; fails when that ignored file is absent
```

`test:deployment` is a gate for `pnpm run deploy:prod` and `pnpm run validate:deepseek-route`; it checks the live deployment database and is expected to fail in a fresh clone. CI (`.github/workflows/dependency-validation.yml`) runs the unit and security tests and a container build on every push to `orcaflow`.

---

## Security

OrcaFlow includes security hardening over the base 9Router:

- **No telemetry**: No analytics SDKs, no tracking pixels, no beacons
- **Cloud sync not wired in**: The cloud sync modules exist in `src/shared/services/` but are not imported by app initialization
- **Tunnel disabled by default**: `tunnelEnabled` defaults to `false`; enabling it downloads and runs `cloudflared`
- **Header masking**: Sensitive headers (authorization, API keys, tokens) are masked in request logs
- **Management API authentication**: Dashboard and management routes require an authenticated session; see [Configuration](#management-api-authentication)
- **Local-only data**: All usage data, credentials, and logs stay on your machine
- **Proper `.gitignore`**: `.env`, `data/`, `ecosystem.config.*`, `logs/` are all excluded

**Dependency advisories (as of 2026-10-20).** GitHub reports 0 open Dependabot, code-scanning and secret-scanning alerts for this repository. Two transitive packages with upstream advisories are replaced by locally patched copies rather than registry versions: `braces` (`vendor/braces-3.0.3.tgz`) and `node-forge` (`vendor/node-forge-1.4.0.tgz`, patch notes in `vendor/node-forge/upstream.patch` referencing CVE-2026-33894, CVE-2026-85393 and GHSA-ppp5-5v6c-4jwp). `pnpm.overrides` in `package.json` pins both, and `scripts/verify-braces.cjs` and `scripts/verify-forge.cjs` fail the build if an unpatched registry copy is installed or the vendored files do not match `integrity.json`.

See [SECURITY.md](SECURITY.md) for our security policy and vulnerability reporting.

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT License: see [LICENSE](LICENSE) for details.

This project is a fork of [9Router](https://github.com/decolua/9router) which is also MIT licensed. The original copyright notice is preserved.

---

<div align="center">
  <sub>Built by <b>Alex Cinovoj, Founder & CTO of TechTide AI</b> on top of <a href="https://github.com/decolua/9router">9Router</a></sub>
</div>
