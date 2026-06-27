# Changelog

## [0.0.4] - 2026-06-27

### Added
- Desktop auto-update checks and updater endpoint.
- Server output surface for viewing server logs in the desktop app.
- Codex CLI support wired into the desktop server.

### Changed
- Canonicalized startup environment variables to the `YEP_` prefix, with migration from legacy names.
- macOS builds are now signed with Developer ID and notarized; Windows builds are signed via Azure Trusted Signing.

## [0.0.3] - 2026-06-01

### Fixed
- Allow unsigned macOS desktop builds when Developer ID signing secrets are not configured.

## [0.0.2] - 2026-06-01

### Added
- Windows local installer script for testing the desktop app from a normal per-user installation.
- Claude child-process diagnostics for Windows session startup failures.

### Fixed
- Desktop startup health probe and allowed-host handling for Windows Tauri origins.

## [0.0.1] - 2026-06-01

### Added
- Disposable desktop release for validating CI artifacts, signing fallback, and release publishing.

## [0.1.0] - Unreleased

### Added
- Initial desktop app with setup wizard
- Bundled Bun runtime for running Yep Anywhere server
- Agent installation (Claude Code, Codex CLI)
- System tray with server management
- Auto-start and window state persistence
- Auto-updater support
