# Changelog

All notable changes to OrcaFlow are documented here. This project is a fork of [9Router](https://github.com/decolua/9router).

## [1.0.0] — 2026-03-10 (OrcaFlow Initial Release)

### Added
- Full rebrand to **OrcaFlow** by TechTide AI
- Professional README with full upstream 9Router credit
- CONTRIBUTING.md, SECURITY.md, and GitHub issue/PR templates
- Repository topics and metadata for discoverability

### Security
- Re-enabled `maskSensitiveHeaders()` in request logger to prevent token leaks
- Cloud sync disabled by default
- Cloudflare tunnel disabled by default

### Changed
- All UI references updated from "9Router" to "OrcaFlow"
- GitHub links point to `Alexi5000/9router_OrcaFlow`
- Package name changed to `orcaflow`

---

*The following entries are from the upstream [9Router](https://github.com/decolua/9router) project, preserved for reference.*

---

## Unreleased (Upstream)

### Features
- Added API key visibility toggle (eye icon) to Endpoint dashboard page for improved UX and security.

## v0.2.66 (2026-02-06)

### Features
- Added Cursor provider end-to-end support, including OAuth import flow and translator/executor integration.
- Enhanced auth/settings flow with `requireLogin` control and `hasPassword` state handling.
- Improved usage/quota UX with richer provider limit cards, new quota table, and clearer reset/countdown display.
- Added model support for custom providers in UI/combos/model selection.
- Expanded model/provider catalog: GPT-5.3, Claude Opus 4.6, MiniMax Coding, iFlow Kimi K2.5, Droid/OpenClaw.
- Added auto-validation for provider API keys when saving settings.

### Fixes
- Improved local-network compatibility for HTTP deployments.
- Improved Antigravity quota/stream handling and Droid CLI compatibility.
- Fixed GitHub Copilot model mapping/selection issues.
- Hardened local DB with corrupt JSON recovery and schema migration safeguards.
- Fixed logout/login edge cases (auto-login prevention, infinite loading fix).

## v0.2.56 (2026-02-04)

### Features
- Added Anthropic-compatible provider support across API/UI flow.
- Added provider icons to dashboard pages.
- Enhanced usage tracking pipeline with buffered accounting improvements.

### Fixes
- Fixed usage conversion and provider limits presentation issues.

## v0.2.52 (2026-02-02)

### Features
- Implemented Codex Cursor compatibility and Next.js 16 proxy migration.
- Added OpenAI-compatible provider nodes with CRUD/validation/test coverage.
- Added token expiration and key-validity checks in provider test flow.
- Added Kiro token refresh support.
- Added non-streaming response translation support for multiple formats.

### Fixes
- Fixed cloud translation/request compatibility path.
- Fixed Kiro auth modal/flow issues.
- Antigravity stability fixes in translator/executor flow.

## v0.2.43 (2026-01-27)

### Fixes
- Fixed CLI tools model selection behavior.
- Fixed Kiro translator request handling.

## v0.2.36 (2026-01-19)

### Features
- Added the Usage dashboard page and usage stats components.
- Integrated outbound proxy support in Open SSE fetch pipeline.
- Improved OpenAI compatibility and build stability.

### Fixes
- Fixed combo fallback behavior.
- Resolved SonarQube findings and build/lint cleanups.

## v0.2.31 (2026-01-18)

### Fixes
- Fixed Kiro token refresh and executor behavior.
- Fixed Kiro request translation handling.

## v0.2.27 (2026-01-15)

### Features
- Added Kiro provider support with OAuth flow.

### Fixes
- Fixed Codex provider behavior.

## v0.2.21 (2026-01-12)

### Changes
- README updates.
- Antigravity bug fixes.
