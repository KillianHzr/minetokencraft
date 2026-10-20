<div align="center">

<img src="public/favicon.svg" width="88" alt="">

# MineTokenCraft

**Watch every Claude Code session you run, live, in a 3D Minecraft village.**
Who is working, who is waiting for you, who is done, how full each context is, what it costs, and how much quota is left on each of your accounts. At a glance, on one screen.

[![check](https://github.com/KillianHzr/minetokencraft/actions/workflows/check.yml/badge.svg)](https://github.com/KillianHzr/minetokencraft/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0a66c2.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-555)](#requirements)
[![Claude Code](https://img.shields.io/badge/for-Claude%20Code-D97757?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![three.js](https://img.shields.io/badge/three.js-r186-111?logo=three.js&logoColor=white)](https://threejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-0a66c2.svg)](#contributing)

**[▶ Try the live demo](https://killianhzr.github.io/minetokencraft/)**, with fake sessions, right in your browser.

English · [Français](README.fr.md)

<img src="docs/demo.gif" alt="MineTokenCraft in action: sessions at work, the tooltip of a waiting session, accounts out of quota moving to the Nether and the End, a rainy night, simple mode" width="100%">

</div>

> [!NOTE]
> Everything runs on your machine. The server only listens on `127.0.0.1`, and nothing about your sessions leaves it.
> The interface speaks English and French: it follows your browser, and the toolbar switches it.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Accounts and quotas](#accounts-and-quotas)
- [Reading the village](#reading-the-village)
- [Simple mode](#simple-mode)
- [Configuration](#configuration)
- [Privacy and security](#privacy-and-security)
- [Performance](#performance)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)
- [License](#license)

## Features

- 🤝 **Codex and Gemini CLI too.** Used one of them lately? It gets a wing of its own, with its sessions, plan, sub-agents, context, cost and (for Codex) its quotas, read from its logs.
- 🏠 **One wing per account, one room per session.** Every Claude Code session is a player with a real Minecraft skin; every sub-agent is a villager working at its job block in the same room.
- 🚦 **Status you can read from across the room.** Waiting for you (orange, waving, with a `!` that grows the longer you wait), working (yellow, at the furniture of the tool in use), done (blue, sitting in the armchair), possibly stuck (black smoke).
- 📊 **Quotas for every account.** 5-hour and weekly usage as Minecraft boss bars at the top of the screen, with a forecast of when the 5-hour quota runs out at this pace. An account that hits its 5-hour limit moves its whole wing to the **Nether**; its weekly limit, to the **End**.
- 🧠 **Context, tasks and cost per session.** An XP bar for the context window, cobwebs creeping into the room as it fills up, redstone lamps lighting up as the task list advances, emerald blocks piling up with the cost. All read from the transcripts: no setup needed.
- 📈 **Usage over the day and the week.** Cost or tokens hour by hour today, day by day over 7 days, per account, compared with a usual day.
- 🌦️ **A living world.** Real time of day, real local weather (rain splashing on the ground, storms, snow, fog drifting over the mountains), a rainbow once the rain stops, torches lighting the path at night, seasons (spring meadows, autumn leaves, winter snow), wind in the grass, animals by day, monsters at night: and you can fight them with a diamond sword.
- 🏷️ **Out of the way.** Just a nametag over each player; hover a room for a Minecraft-style tooltip with the details.
- ♿ **Calm when asked.** With *reduce motion* turned on in the system, no lightning flashes, no blinking, still water and grass, fewer particles.
- 🖱️ **Click a room to jump to its terminal** (Terminal, iTerm, JetBrains IDEs on macOS), or open the session history.
- 🧾 **Simple mode.** A clean, light dashboard with the same information, no game.
- ⚡ **Light on resources.** About 200 draw calls a frame, 30 fps when focused, 20 when not, nothing when the tab is hidden.

<table>
  <tr>
    <td colspan="2"><img src="docs/screenshots/village.jpg" alt="The village by day: one wing per Claude account, one room per session"></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><sub>A day in the village, each session at the furniture of its tool</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/nether-end.jpg" alt="One account out of 5-hour quota in the Nether, the other out of weekly quota in the End, at night"></td>
    <td width="50%"><img src="docs/screenshots/winter.jpg" alt="Winter: snow on the ground and on the trees, frozen river"></td>
  </tr>
  <tr>
    <td align="center"><sub>Out of quota: the Nether (5 h) and the End (week), at night</sub></td>
    <td align="center"><sub>Winter, with snow falling</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/simple.jpg" alt="Simple mode: a light dashboard with quotas and three columns"></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><sub>Simple mode</sub></td>
  </tr>
</table>

## Requirements

- [Node.js](https://nodejs.org) 20 or later
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), on **macOS**, **Linux** or **Windows**

| | macOS | Linux | Windows |
| --- | :---: | :---: | :---: |
| Village, simple mode, quotas, context, cost, usage | ✓ | ✓ | ✓ |
| Notifications | ✓ | ✓ (with `notify-send`) | |
| Start at login (`minetokencraft autostart`) | ✓ (launchd) | ✓ (systemd) | |
| Click a room to bring its terminal to the front | ✓ | | |
| Read the Claude Code login from the Keychain | ✓ | | |

Every change is tested on the three systems.
- A browser with WebGL

## Quick start

```sh
npm install -g github:KillianHzr/minetokencraft
minetokencraft
```

The first launch downloads the Minecraft textures, the font and a few skins into `~/.cache/minetokencraft/assets` (about 1 MB), starts the server in the background and opens <http://localhost:4747>. Run `minetokencraft` again any time: it reuses the running server and just opens the page.

<details>
<summary>From a clone instead</summary>

```sh
git clone https://github.com/KillianHzr/minetokencraft.git
cd minetokencraft
npm install
npm link        # makes the `minetokencraft` command available
minetokencraft
```

</details>

Want to see it first? The [live demo](https://killianhzr.github.io/minetokencraft/) runs in your browser with fake sessions in every state, and lets you switch the time, weather, season and quota scenario. `minetokencraft demo` opens the same page locally.

## Commands

| Command | What it does |
| --- | --- |
| `minetokencraft` | Starts the server if needed and opens the page |
| `minetokencraft demo` | Opens the test page with fake sessions |
| `minetokencraft stop` | Stops a server started by `minetokencraft` |
| `minetokencraft serve` | Runs the server in the foreground, logs in the terminal |
| `minetokencraft autostart on` · `off` · `status` | Starts the server at login (macOS with launchd, Linux with systemd) |
| `minetokencraft assets [--refresh-skins] [--skins a,b,c]` | Downloads the assets again, or other skins |
| `minetokencraft statusline [--quiet]` | Status line command for Claude Code (optional, [see below](#optional-status-line)) |

## Accounts and quotas

### Accounts are found on their own

An account is a Claude Code config folder. MineTokenCraft finds them without any setup:

- `~/.claude` (the default one) and `~/.config/claude`
- every `~/.claude-*` and `~/.claude_*` folder, the usual way to run several accounts
- the folders listed in `CLAUDE_CONFIG_DIR`
- any folder you add in **Settings**

Each one gets its own wing, color and style, in that order. In **Settings** you can rename an account, hide it, or add a folder.

### Codex and Gemini CLI

If [Codex CLI](https://github.com/openai/codex) (`~/.codex`, or `CODEX_HOME`) or [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`~/.gemini`) was used in the last 8 days, it gets a wing after the Claude Code accounts. Neither keeps a list of running sessions, so a session is shown while its log moves: working during a turn, waiting when Codex asks you something, done after. Codex's quotas (5 hours and week) come from its logs; Gemini CLI writes none. Clicking one of their rooms cannot bring a terminal to the front: they do not say which one runs the session.

### Where quotas come from

1. **Your Claude Code login**, the same official numbers as `/usage`. The token is read from `<folder>/.credentials.json`, or on macOS from the Keychain, **only after you allow it** for that account in **Settings** (macOS then asks once: pick *Always Allow*). The token is never refreshed or stored by MineTokenCraft, so it never interferes with Claude Code's own login.
2. **A claude.ai session key**, as a fallback: paste it in **Settings** for an account. It stays in a file only you can read and never goes back to the page.
3. **The status line**, if you install it (below), as a last resort.

Context and cost do not need any of this: they come from the transcripts. The context is the prompt of the last request over the model's window (200k, or 1M for `[1m]` models). The cost prices every request at Anthropic's list prices, cache writes included (the 1-hour cache Claude Code uses costs twice the input price), counts each request once even when it is copied into a resumed session, and includes sub-agents. It is what the same tokens would cost through the API: a subscription is billed differently.

<details>
<summary><a id="optional-status-line"></a>Optional: the status line</summary>

Claude Code passes the session's context, cost and quotas to its status line command. MineTokenCraft can keep a copy of it, useful for quotas when neither the login nor a session key is available. In `~/.claude/settings.json` (and in each other config folder):

```json
{
  "statusLine": { "type": "command", "command": "minetokencraft statusline" }
}
```

Already have a status line? Keep it, and call MineTokenCraft silently from your script:

```sh
input=$(cat)
printf '%s' "$input" | minetokencraft statusline --quiet
# … your own status line, using "$input"
```

</details>

## Reading the village

| You see | It means |
| --- | --- |
| Nametag over a player | The session's name, with its status icon; hover the room for everything else |
| Player waving at the front of the room, `!` over the head, orange frame | The session is waiting for you (permission, question). After 5 minutes the nametag turns orange, the `!` grows and the bell rings again |
| Player at a furniture, yellow frame | Working: bookshelf to think or read, furnace for shell commands, cartography table for the web, crafting table to edit files |
| Player in the armchair, blue frame | Done |
| Black smoke above the room | Working but nothing written for 8 minutes: maybe stuck |
| Villagers | Sub-agents, at the job block of their type (Explore is a cartographer, Plan a librarian…) |
| A wolf or a cat | The session's pet: the wolf stays by its player and wags its tail as it works (faster when it waits for you), the cat strolls around and naps by the armchair once the session is done |
| Redstone lamps on the back wall | Task list progress; the current task blinks |
| Cobwebs | Context window filling up (60, 75, 85, 95 %) |
| Emerald blocks | Session cost, one more each time it doubles |
| A painting on the back wall | The session has been running for more than an hour |
| Item frames on the desks | The two tools the session uses the most |
| Chests by the armchair | Files edited: one chest, a second at 20 edits, a third at 60; the newest opens while a file is being written |
| Boss bars at the top | Each account's 5-hour (top) and weekly (bottom) quota, filling up as it is used |
| Obsidian frame and eyes of ender by the house | Same quotas, building a Nether portal and an End portal |
| Wing turned into the Nether or the End | That account is out of 5-hour or weekly quota |

Click a room or a card to bring its terminal to the front. Double-click a room to zoom on it (double-click again, or Esc, to see the whole village). Click a villager, or its line in the side panel, to see what that sub-agent did. The book icon opens the session history. **Focus** in the toolbar darkens everything but the sessions waiting for you. And click a mob: it takes a diamond sword hit, and respawns 5 seconds after dying.

## Simple mode

The **Simple mode** switch replaces the village with a light dashboard: quotas per account, then *Your turn*, *In progress*, *Done*, and the idle sessions. It shrinks itself to fit the screen without scrolling. The choice is remembered.

## Configuration

Everything is set from the page (**Settings**). Files and environment variables, for reference:

| | Default |
| --- | --- |
| Settings (accounts, session keys, city, language) | `~/.config/minetokencraft/settings.json` (`XDG_CONFIG_HOME`; on Windows `%APPDATA%\minetokencraft`) |
| Cache (status line copies, quota history, server log) | `~/.cache/minetokencraft/` (`XDG_CACHE_HOME`; on Windows `%LOCALAPPDATA%\minetokencraft`) |
| Port | `4747` (`MINETOKENCRAFT_PORT`) |
| Weather location | The city of your time zone, or the one set in **Settings** |
| Language | Your browser's, or the one picked in the toolbar; notifications and the command line follow it |
| Skins | A list of well-known Minecraft creators; `minetokencraft assets --skins name1,name2` for others |

## Privacy and security

- The server listens on `127.0.0.1` only, and rejects requests whose `Host` is not local (no DNS rebinding).
- Requests that change something must be JSON, which another website open in your browser cannot send.
- The page runs under a strict Content Security Policy: it only loads its own scripts, styles, fonts and images, and only talks to the local server.
- Session keys and tokens never reach the page. Settings are stored with `0600` permissions.
- Network calls MineTokenCraft makes, and nothing else:
  - [Open-Meteo](https://open-meteo.com) for the weather (no key, only coordinates of a city);
  - Anthropic (`api.anthropic.com`) and, if you set a session key, `claude.ai`, for your quotas;
  - GitHub, jsDelivr and Mojang, once, to download the textures, the fonts and the skins. The page itself never calls any other site (no Google Fonts, no CDN).
- No telemetry, no analytics.

## Performance

The page is meant to stay open all day:

- 30 fps at most, 20 when the window is not focused, nothing when the tab is hidden
- canvas capped at 1.25× the screen resolution
- each character is a single skinned mesh; particles, blocks and props are instanced: about 200 draw calls a frame
- shadows recomputed 10 times a second, on the house only
- room lamps only lit after dusk

`minetokencraft.perf()` in the browser console shows draw calls and time per frame.

## FAQ

<details>
<summary><b>No quotas show up for an account</b></summary>

Open **Settings**. If the account's login is in the macOS Keychain, click **Allow access** and choose *Always Allow* in the macOS dialog. Otherwise paste a claude.ai session key, or install the [status line](#optional-status-line).

</details>

<details>
<summary><b>macOS asks for my password or for Keychain access</b></summary>

That is the Keychain prompt for reading Claude Code's login, which only happens after you allowed it in **Settings**. Choose *Always Allow* so it does not come back. Click **Stop reading** to stop it.

</details>

<details>
<summary><b>Clicking a room does not select the right terminal tab</b></summary>

Terminal and iTerm get the exact tab. JetBrains IDEs only let MineTokenCraft bring the right project window to the front: the terminal tab inside it has to be picked by hand. Background tasks have no terminal.

</details>

<details>
<summary><b>The page is empty</b></summary>

No Claude Code session is running, or they are all idle for more than an hour (they are then listed in the side panel). `minetokencraft demo` shows what it looks like with sessions.

</details>

<details>
<summary><b>Port 4747 is taken</b></summary>

`MINETOKENCRAFT_PORT=4800 minetokencraft`

</details>

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for the layout of the code and the guidelines, [CHANGELOG.md](CHANGELOG.md) for what changed in each version, and [SECURITY.md](SECURITY.md) to report a vulnerability privately.

```sh
npm install
npm run check   # syntax of every file, server modules, translations, npm package contents
npm test        # tests on a fake home folder: accounts, transcripts, cost, quotas, server
minetokencraft serve
```

Then open <http://localhost:4747/demo> to see every state without real sessions. No build step: the page is plain ES modules and [three.js](https://threejs.org).

The interface is translated in `public/js/locales` (page) and `lib/locales` (notifications, command line). English is the reference: a new string goes into every language, and `npm run check` fails when keys or placeholders differ.

## Disclaimer

MineTokenCraft is an independent project, not affiliated with or endorsed by Anthropic, Mojang Studios or Microsoft. *Claude* and *Claude Code* are trademarks of Anthropic; *Minecraft* is a trademark of Mojang Studios. The Minecraft textures and skins are not part of this repository: they are downloaded to your machine from public sources on first launch and stay there. Skins belong to their owners.

## License

[MIT](LICENSE)
