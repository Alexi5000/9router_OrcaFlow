# Contributing to OrcaFlow

Thank you for your interest in contributing to OrcaFlow! This project is a fork of [9Router](https://github.com/decolua/9router) maintained by TechTide AI.

## Getting Started

1. **Fork** this repository
2. **Clone** your fork locally
3. **Install** dependencies:
   ```bash
   cp .env.example .env
   npm install
   ```
4. **Run** the development server:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:20128` to verify everything works

## Development Workflow

1. Create a feature branch from `orcaflow`:
   ```bash
   git checkout -b feature/your-feature
   ```
2. Make your changes
3. Test locally — ensure the dashboard loads and routing works
4. Commit with a clear message
5. Push and open a Pull Request

## Project Structure

```
src/                    # Next.js frontend (dashboard + landing page)
  app/                  # App router pages
  shared/               # Shared components and constants
open-sse/               # Core routing engine
  providers/            # AI provider integrations
  converters/           # Format translation (OpenAI <-> Claude <-> Gemini)
  utils/                # Utilities (logger, request handling)
```

## Guidelines

- **No secrets in code** — Use `.env` for all credentials. Never commit API keys, tokens, or passwords.
- **Test your changes** — Verify provider routing still works after modifications.
- **Keep it simple** — Small, focused PRs are easier to review.
- **Credit upstream** — If porting a fix from 9Router, reference the original commit/PR.

## Reporting Bugs

Use the [GitHub Issues](https://github.com/Alexi5000/9router_OrcaFlow/issues) tab with the bug report template.

For bugs in the core routing engine that also affect upstream 9Router, please consider reporting to [9Router issues](https://github.com/decolua/9router/issues) as well.

## Security

If you discover a security vulnerability, please see [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
