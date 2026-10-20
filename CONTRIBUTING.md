# Contributing to MineTokenCraft

Thanks for your interest! Bug reports, ideas and pull requests are all welcome.

## Getting started

```sh
git clone https://github.com/KillianHzr/minetokencraft.git
cd minetokencraft
npm install
npm run check          # syntax, server modules, translations, npm package contents
node bin/minetokencraft.mjs serve
```

Then open <http://localhost:4747/demo>: the test page shows every state (waiting, working, done, stuck, out of quota…) with fake sessions, and lets you force the time, the weather and the season. <http://localhost:4747> shows your real sessions.

There is no build step. The page is plain ES modules served as they are, with [three.js](https://threejs.org) as the only dependency; the server is plain Node.js (20 or later) with no dependency at all.

## Where things are

| Folder | What lives there |
| --- | --- |
| `bin/` | The `minetokencraft` command |
| `server.mjs`, `config.mjs` | Local HTTP server (page, API, live updates), paths and timings |
| `lib/` | Reading Claude Code data: accounts, sessions, transcripts, quotas, git, weather, notifications |
| `lib/locales/` | What the server says itself (notifications, command line), one file per language |
| `public/js/` | The page: 3D world, characters, mobs, panels, simple mode |
| `public/js/locales/` | Page strings, one file per language |
| `scripts/` | Assets download, status line copy, autostart, checks, demo build, captures |

## Guidelines

- **Keep it light.** The page is meant to stay open all day. Check `minetokencraft.perf()` in the browser console before and after a change to the scene: draw calls and milliseconds per frame should not grow without a good reason.
- **Translations.** English is the reference. Every new string goes into `public/js/locales/en.js` **and** every other language (or `lib/locales/` for the server). `npm run check` fails when keys or placeholders differ. Values hold no HTML.
- **Colors.** States use blue, yellow and orange, never green against red, so they stay readable with color blindness.
- **Privacy.** Nothing about the user's sessions may leave the machine. Tokens and session keys never reach the page.
- **Style.** Match the code around you: small functions, a comment when the *why* is not obvious, no em dashes in text.
- **Screenshots.** After a visible change, `npm run capture` (needs Chrome and ffmpeg, and a running server) takes the README screenshots, the animation and the social preview again.

## Pull requests

1. Fork, then create a branch from `main`.
2. Make your change, with `npm run check` passing.
3. Try it on the test page, in both languages if you touched text.
4. Open the pull request with a short description and, for a visible change, a screenshot.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`…).

## Releases

Maintainers bump the version with `npm version minor` (or `patch`), move the `Unreleased` notes of `CHANGELOG.md` under the new version, and push the tag: the release workflow creates the GitHub release and publishes to npm.
