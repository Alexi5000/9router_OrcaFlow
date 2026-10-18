# Braces security backport

This is braces 3.0.3 with the depth and cyclic-parent guards from upstream proposal https://github.com/micromatch/braces/pull/72 at commit 28d440b5dd449dbf1fe6f3506cf94ecca4d02660. The proposal was closed without an official release. This is a maintained local backport, not an upstream patched version. The original package name, version, and MIT license are retained.

The complete proposal test suite passed locally: 904 tests on Node 22.22.2. Normal expansion, fractional depth limits, malformed input, direct AST depth, and parent cycles are covered by that suite. Remove this override only when a supported upstream release or compatible replacement contains these protections. Owner: repository maintainer. Review by 2026-11-18.
