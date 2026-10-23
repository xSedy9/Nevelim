# Security Policy

## Supported versions

The project is in active development; only the latest build of the default branch
receives security fixes.

| Version | Supported |
|---------|-----------|
| latest `main` | ✅ |
| anything else | ❌ |

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
for this repository, or contact the maintainers directly. Include a description of the
issue, steps to reproduce and the affected platform (Windows / macOS / Linux).

You can expect an initial response within a few days. We will credit reporters in the
release notes unless they prefer to stay anonymous.

## Scope notes

- **Never commit API keys.** Provider keys (Gemini / OpenAI / OpenRouter) belong in your
  local `config.json`, which is git-ignored. Use `config.example.json` as the template.
- The app executes clipboard paste into the previously focused window and sends prompt
  content to third-party AI providers — keep this in mind when testing with sensitive
  data.
