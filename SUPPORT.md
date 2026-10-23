# Support

Need help with Quick Snippets? Here is where to go:

- **Bug reports & feature requests** — open a
  [GitHub Issue](../../issues). Please include your OS version, app version and steps
  to reproduce.
- **Questions & usage help** — open a topic in
  [GitHub Discussions](../../discussions).
- **Documentation** — check the [docs/](docs/) folder first: it contains the technical
  specification, configuration reference and architecture notes.

## Common problems

- **Hotkey does not trigger** — make sure the combination is not occupied by another
  app, and check `hotkey` in `config.json`.
- **AI adaptation fails** — verify the provider API key in `config.json`
  (see `config.example.json` for the schema) and your network connection.
- **Overlay does not appear** — on Linux a running compositor is required for
  transparent windows; on Wayland support is best-effort (X11 recommended).

## Commercial support

None at the moment — this is a community project. Security issues go through
[SECURITY.md](SECURITY.md).
