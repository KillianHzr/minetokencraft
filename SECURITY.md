# Security policy

MineTokenCraft reads your Claude Code data, and with your permission the Claude Code login token (to fetch your quotas) or a claude.ai session key. Security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through [GitHub security advisories](https://github.com/KillianHzr/minetokencraft/security/advisories/new). You should get an answer within a week.

## What is in scope

- The local server: it must only answer on `127.0.0.1`, to local `Host` names, and only accept JSON for requests that change something.
- Secrets: tokens and session keys must never reach the page, the logs or any host other than Anthropic and claude.ai.
- Anything that lets a web page, another user of the machine or a crafted transcript read data or run code through MineTokenCraft.

## Supported versions

Only the latest release gets fixes.
