# OrcaFlow — TechTide AI Router

OrcaFlow is TechTide's AI router/proxy, based on [9Router](https://github.com/9router/9router). It routes LLM requests to the cheapest or fastest available provider (OpenAI, Anthropic, Google) with automatic failover when a provider is unavailable or rate-limited.

## Design Principles

- **Self-hosted, no cloud dependency** — runs entirely on the user's own infrastructure. No data leaves the network unless it's headed to an LLM provider.
- **Single endpoint for all models** — field engineers get one URL that works behind client firewalls, regardless of which upstream provider ultimately serves the request.
- **Cost and latency optimization** — requests are routed based on configurable rules: cheapest model that meets the quality threshold, fastest response time, or explicit provider preference.

## Why the Fork Exists

TechTide deploys LLM tooling for field engineers working on-site behind restrictive corporate firewalls. A single, self-hosted proxy that handles provider selection, failover, and auth simplifies operations dramatically compared to managing multiple API keys and provider-specific SDKs per client site.

## What This Fork Adds

- **Custom branding** — OrcaFlow identity, TechTide logos, branded admin UI
- **Security hardening** — stricter TLS defaults, token rotation, audit logging
- **Per-client rate limiting** — each downstream client gets independent quota enforcement to prevent noisy-neighbor issues in shared deployments
- **TechTide deployment configs** — Docker Compose files, systemd units, and environment templates tuned for TechTide's standard field deployment pattern
