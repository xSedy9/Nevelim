# Contributing to Quick Snippets

Thank you for considering a contribution! This project follows a strict, boring,
predictable workflow — please read this page before opening a pull request.

## Development workflow

1. **One branch per feature.** Every new feature, bugfix or refactor is developed in an
   isolated branch. Branch names follow Conventional Commits style:
   `<type>/<description>` (e.g. `feat/overlay-animations`, `fix/modal-focus-loss`).
2. **Write tests.** New features must keep test coverage at **90% minimum** —
   pull requests below this threshold cannot be merged. See "Testing" below.
3. **Run all checks** before requesting a merge:
   - TypeScript: `npm run lint`, `npm run typecheck`, `npm run test`
   - Rust: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`
   - Full build must succeed for the target platform.
4. **Merge** into the default branch happens only after all checks pass.
   The merge commit itself must also follow Conventional Commits.

## Commit messages

Strict format: `<type>(<scope>): <subject>` — for example `feat(overlay): add scroll easing`.

- One commit = one atomic, logical change with a short message.
- Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.
- A scope is **required**: `core`, `overlay`, `modal`, `ui`, `desktop`, `repo`, …

## Testing

- Frontend tests live in `tests/frontend/` and run with Vitest.
- End-to-end tests live in `tests/e2e/`.
- Rust unit tests may live next to the code (`#[cfg(test)]` modules) per Cargo
  conventions; Rust integration tests belong in the `tests/` directory of the
  corresponding crate (`src/backend/tests/`, `src/desktop/tests/`).

## Code style

- Every function, class, struct, trait, module or hook needs an in-code description:
  TSDoc (`/** ... */`) for TypeScript, Rustdoc (`/// ...`) for Rust.
- Platform-specific code must be isolated in `#[cfg(target_os)]` modules — shared code
  must not depend on Win32/macOS/Linux APIs directly.

## Reporting issues

Please open a GitHub Issue with reproduction steps, expected vs actual behavior and your
OS version. For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead.

By participating in this project you agree to abide by the
[Code of Conduct](CODE_OF_CONDUCT.md).
