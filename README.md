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

## Credits & Acknowledgments

**OrcaFlow is a customized fork of [9Router](https://github.com/decolua/9router)** by [decolua](https://github.com/decolua) and contributors.

We give full credit to the 9Router project for the core routing engine, provider integrations, and architecture that makes this possible.

|                      |                                                                                 |
| -------------------- | ------------------------------------------------------------------------------- |
| **Original Project** | [github.com/decolua/9router](https://github.com/decolua/9router)                |
| **9Router Website**  | [9router.com](https://9router.com)                                              |
| **Original License** | MIT (preserved in this fork)                                                    |
| **Contributors**     | [View all contributors](https://github.com/decolua/9router/graphs/contributors) |

---

## What is OrcaFlow?

OrcaFlow is a local AI proxy/router that sits between your coding tools and AI providers. It gives you:

- **One endpoint** (`http://localhost:20128/v1`) for all AI providers
- **Smart 3-tier fallback**: Subscription &rarr; Cheap &rarr; Free, automatically
- **Format translation**: OpenAI &harr; Claude &harr; Gemini, seamlessly
- **Multi-account support**: Round-robin between accounts per provider
- **Usage analytics**: Track tokens, costs, and trends locally
- **Zero telemetry**: Everything runs locally, no data leaves your machine

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

## What's Different in OrcaFlow?

OrcaFlow builds on 9Router with the following customizations by TechTide AI:

| Change                  | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| **Custom branding**     | OrcaFlow identity throughout the UI                                |
| **Security hardening**  | Re-enabled header masking in request logger to prevent token leaks |
| **Cloud sync disabled** | No phone-home capability active                                    |
| **Team customizations** | Provider configs, UI themes, and workflow optimizations            |

---

## Quick Start

### From source (recommended)

```bash
git clone https://github.com/Alexi5000/9router_OrcaFlow.git
cd 9router_OrcaFlow
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

Dashboard opens at `http://localhost:20128`

### Production mode

```bash
pnpm build
PORT=20128 pnpm start
```

### Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm verify
```

---

## Supported CLI Tools

Works with all major AI coding tools:

| Tool            | Status          |
| --------------- | --------------- |
| Claude Code     | Fully supported |
| OpenAI Codex    | Fully supported |
| Cursor          | Fully supported |
| Cline / RooCode | Fully supported |
| Continue        | Fully supported |
| GitHub Copilot  | Fully supported |
| OpenClaw        | Fully supported |
| Gemini CLI      | Fully supported |

**Configuration** (same for all tools):

```
Endpoint: http://localhost:20128/v1
API Key:  [copy from OrcaFlow dashboard]
Model:    cc/claude-opus-4-6  (or any supported model)
```

---

## Supported Providers

### OAuth Providers (Free login)

| Provider       | Models                  | Quota             |
| -------------- | ----------------------- | ----------------- |
| Claude Code    | Opus, Sonnet, Haiku     | 5h + weekly reset |
| OpenAI Codex   | GPT-5.2, GPT-5.1        | 5h + weekly reset |
| Gemini CLI     | Gemini 3 Flash, 2.5 Pro | 180K/month FREE   |
| GitHub Copilot | GPT-5, Claude 4.5       | Monthly reset     |
| Cursor         | Various                 | Per subscription  |

### Free Providers (Unlimited)

| Provider  | Models                                   | Cost |
| --------- | ---------------------------------------- | ---- |
| iFlow AI  | 8+ models (Kimi K2, Qwen, GLM, DeepSeek) | $0   |
| Qwen Code | Qwen 3 Coder Plus/Flash                  | $0   |
| Kiro AI   | Claude Sonnet/Haiku                      | $0   |

### API Key Providers (40+)

OpenRouter, GLM, Kimi, MiniMax, OpenAI, Anthropic, Gemini, DeepSeek, Groq, xAI, Mistral, Perplexity, Together AI, Fireworks, Cerebras, Cohere, NVIDIA, SiliconFlow, and 20+ more.

---

## Key Features

| Feature                      | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| **Smart 3-Tier Fallback**    | Auto-route: Subscription &rarr; Cheap &rarr; Free  |
| **Real-Time Quota Tracking** | Live token count + reset countdown                 |
| **Format Translation**       | OpenAI &harr; Claude &harr; Gemini seamless        |
| **Multi-Account Support**    | Multiple accounts per provider with round-robin    |
| **Auto Token Refresh**       | OAuth tokens refresh automatically                 |
| **Custom Combos**            | Create unlimited model combinations                |
| **Usage Analytics**          | Track tokens, cost, trends locally                 |
| **MITM Proxy**               | Intercept CLI tool traffic for transparent routing |

---

## Configuration

### Environment Variables

| Variable                | Default          | Description                              |
| ----------------------- | ---------------- | ---------------------------------------- |
| `PORT`                  | `20128`          | Service port                             |
| `JWT_SECRET`            | (auto-generated) | JWT signing secret                       |
| `INITIAL_PASSWORD`      | `change-me`      | First login password                     |
| `REQUIRE_API_KEY`       | `false`          | Enforce Bearer API key on `/v1/*` routes |
| `ENABLE_REQUEST_LOGS`   | `false`          | Enable request/response logs             |
| `OBSERVABILITY_ENABLED` | `true`           | Local usage tracking                     |
| `DATA_DIR`              | `./data`         | Local runtime data directory             |

See `.env.example` for all available variables.

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

| Endpoint                    | Format                  |
| --------------------------- | ----------------------- |
| `POST /v1/chat/completions` | OpenAI format           |
| `POST /v1/messages`         | Anthropic format        |
| `POST /v1/responses`        | OpenAI Responses format |
| `GET /v1/models`            | List all models         |

---

## Tech Stack

| Component     | Technology                          |
| ------------- | ----------------------------------- |
| **Runtime**   | Node.js 20+                         |
| **Framework** | Next.js 16                          |
| **UI**        | React 19 + Tailwind CSS 4           |
| **Database**  | LowDB (JSON file-based, local only) |
| **Streaming** | Server-Sent Events (SSE)            |
| **Auth**      | OAuth 2.0 (PKCE) + JWT + API Keys   |

---

## Security

OrcaFlow includes security hardening over the base 9Router:

- **No telemetry**: No analytics SDKs, no tracking pixels, no beacons
- **Cloud sync disabled**: The cloud sync feature is disabled and commented out
- **Tunnel disabled**: The Cloudflare tunnel feature is disabled by default
- **Header masking**: Sensitive headers (authorization, API keys, tokens) are masked in logs
- **Local-only data**: All usage data, credentials, and logs stay on your machine
- **Proper `.gitignore`**: `.env`, `data/`, `test-results/`, and `logs/` are excluded while docs stay tracked

See [SECURITY.md](SECURITY.md) for our security policy and vulnerability reporting.

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT License &mdash; see [LICENSE](LICENSE) for details.

This project is a fork of [9Router](https://github.com/decolua/9router) which is also MIT licensed. The original copyright notice is preserved.

---

## Upstream

This project is built on top of **[9Router](https://github.com/decolua/9router)** by decolua. All credit for the core routing engine, provider integrations, format translation layer, and architecture goes to the original 9Router team and contributors.

---

<div align="center">
  <sub>Built by <b>TechTide AI</b> on top of <a href="https://github.com/decolua/9router">9Router</a></sub>
</div>
