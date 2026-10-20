# Changelog

All notable changes to MineTokenCraft are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-10-20

### Added

- English interface, now the default, with French kept in sync. The page follows the browser language, and a selector in the toolbar switches it; macOS notifications and the command line follow the same choice.
- `README.fr.md`, a French README.
- An animated tour at the top of the README, and a social preview image for the repository.
- `npm run capture`: takes the README screenshots, the animation and the social preview from the test page in headless Chrome.
- `npm run check` now fails when translations differ between languages, or when the npm package would ship anything but the files that run.

### Changed

- Code comments, logs and documentation are in English.
- Clock times are shorter (`4:55 PM`, `16:55`).
- The npm package only holds what runs (about 140 kB instead of 6 MB).

### Fixed

- The weather tries again after a minute when it fails at startup (no network yet at login), instead of waiting ten minutes.

## [1.0.0] - 2026-10-19

### Added

- First release: every Claude Code session in a 3D Minecraft village, one wing per account and one room per session, sub-agents as villagers.
- Accounts found on their own (`~/.claude`, `~/.claude-*`, `CLAUDE_CONFIG_DIR`, folders added in the settings).
- Official quotas from the Claude Code login (credentials file, or the macOS Keychain once allowed), a claude.ai session key as fallback, or the status line.
- Boss bars for quotas, nametags, Minecraft-style tooltips, Nether and End wings for accounts out of quota.
- Real time, weather and seasons; lamps and portals that light up at dusk; mobs to fight.
- Simple mode, a light dashboard with the same information.
- `minetokencraft` command: open, demo, stop, serve, autostart, assets, statusline.
- A live demo on GitHub Pages.

[Unreleased]: https://github.com/KillianHzr/minetokencraft/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/KillianHzr/minetokencraft/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/KillianHzr/minetokencraft/releases/tag/v1.0.0
