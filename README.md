# Quick Snippets

A cross-platform hotkey-driven snippet launcher with AI-powered template adaptation.
Press a global hotkey and a radial overlay appears right at your cursor: pick a snippet,
pick an action — copy, paste, edit, or adapt it to your project's specification with an
AI provider of your choice (Gemini, OpenAI, OpenRouter).

Built with **Tauri v2** (Rust + TypeScript). No Electron, no heavy UI frameworks —
just a tiny webview, native-speed backend logic and GPU-rendered UI.

> Status: **work in progress** — the project is being rebuilt from the ground up on
> Tauri. See [docs/](docs/) for the current technical specification and roadmap.

## Features (planned / in development)

- Global hotkey summons a lightweight overlay right at the mouse cursor
- Snippet library from plain `templates/*.md` files
- Radial navigation: hub → snippets → actions, fully keyboard-driven
- Actions: copy, paste into the previous window, open in editor, AI-adapt
- AI adaptation against a project specification (`docs/SPECIFICATION.md`, `spec.md`, …)
  with an interactive refinement chat
- Local-first: templates, history and config live on your machine
- Cross-platform: Windows (primary), macOS and Linux (X11) targets

## Repository layout

```
src/frontend/   TypeScript + Vite web layer (overlay & modal UI)
src/backend/    quick-snippets-core: pure Rust business logic (no Tauri dependency)
src/desktop/    quick-snippets-desktop: Tauri shell (windows, hotkeys, plugins)
tests/          Frontend (Vitest) and end-to-end tests
docs/           Technical documentation & specifications
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Development

Prerequisites: [Rust](https://rustup.rs) 1.78+, Node.js 20+, and the
[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
cd src/frontend && npm install   # frontend toolchain
npm run dev                      # frontend dev server
cargo tauri dev                  # desktop shell (from src/desktop)
```

## License

Licensed under the [Apache License 2.0](LICENSE).
