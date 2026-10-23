# Changelog

All notable changes to MineTokenCraft are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.2] - 2026-10-23

### Removed

- The torches along the path around the village.
- Falling rain: a rainy day keeps its grey sky, a storm its lightning, and the rainbow still shows once the rain stops.

## [1.2.1] - 2026-10-21

### Changed

- Published on npm: `npm install -g minetokencraft`.

### Removed

- The menu bar app for macOS: too much for what it brought. `minetokencraft menubar off` from 1.2.0 removes an installed one.

## [1.2.0] - 2026-10-20

### Added

- Context and cost of every session without the status line. The context is the prompt of the last request over the model's window (200k, or 1M for `[1m]` models). The cost prices each request at list prices with the real cache split (1-hour writes at twice the input price, 5-minute writes at 1.25 times), counts each request once even when a resumed session copies it, includes sub-agents, and adds up Claude Code's own ledger over every run of a resumed session.
- A new usage screen: today hour by hour or the last 7 days day by day, in cost or tokens, with each account's share, a scale, a tooltip per column, and today compared with a usual day at the same hour.
- Windows support, and Linux notifications (`notify-send`) and start at login (systemd user service). Continuous integration runs on macOS, Linux and Windows.
- Focus mode: the scene darkens except the rooms of the sessions waiting for you, and the rest of the panel fades.
- Double-click a room to zoom on it; Esc or another double-click to see the whole village. A single click still brings the terminal back, once a double click is ruled out.
- Click a villager (or its line in the panel or simple mode) to see what that sub-agent did. Villagers light up under the pointer, with a tooltip.
- A menu bar app for macOS (`minetokencraft menubar on`): sessions waiting for you, quotas, a click to bring a terminal back, the page to open again. Built on the machine with Swift, started at login.
- Codex CLI and Gemini CLI, when used in the last 8 days, get a wing each: their sessions, plans, sub-agents, context, cost, and Codex's quotas, read from their logs, and their usage in the usage screen.
- The room lives with its session: a painting after an hour, item frames on the desks with its two most used tools, chests that pile up as it edits files (the newest opens while it writes).
- A pet for every player: a wolf that stays by its side and wags its tail as the session works, or a cat that strolls around the room and naps by the armchair once the session is done.
- Torches along the path, lighting the ground at dusk; a rainbow over the landscape once the rain stops (from the real weather of the last hours, or a rain the page saw fall).
- A strict Content Security Policy and security headers on every answer of the server, and in the online demo.
- Reduced motion: when the system asks for it, no lightning flashes, no blinking, still water and grass, fewer particles, no camera easing.
- `npm test`: tests on a fake home folder (accounts, transcripts, cost, context, quotas through a fake network, settings, the HTTP server).

### Changed

- The server answers right away at startup and reads the transcripts afterwards, instead of making the page wait.
- The notifications button is hidden on machines that cannot show them.
- Montserrat, the simple mode font, is downloaded with the other assets instead of being loaded from Google Fonts by the page.

### Fixed

- Rain, snow and fog are now in the scene (drops splashing on the ground, haze over the far mountains) instead of a veil over the whole screen.
- A claude.ai session key that expires after its first use is reported as expired, and a Cloudflare block is no longer mistaken for one.
- Account names from Windows paths.
- Sub-agent messages logged in a session file no longer show as the session's last answer.

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

[Unreleased]: https://github.com/KillianHzr/minetokencraft/compare/v1.2.2...HEAD
[1.2.2]: https://github.com/KillianHzr/minetokencraft/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/KillianHzr/minetokencraft/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/KillianHzr/minetokencraft/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/KillianHzr/minetokencraft/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/KillianHzr/minetokencraft/releases/tag/v1.0.0
