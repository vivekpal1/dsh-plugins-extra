# dsh-telegram

A secure Telegram bot bridge for remotely controlling [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) sessions.

The plugin uses Telegram Bot API long polling, so it works behind NAT without opening a port or deploying a webhook. It integrates with DSH's native session gateway, credentials service, settings UI, event log, and cancellation path.

## Features

- Configure and verify a BotFather token from **DSH Settings → Telegram**.
- Store the token through DSH credentials under `DSH_TELEGRAM_BOT_TOKEN`; it never enters plugin settings, browser responses, logs, or agent context.
- Deny all access until a private chat completes a locally generated, five-minute, single-use pairing challenge.
- Bind authorization to the exact Telegram user ID and private chat ID.
- Create, select, rename, prompt, inspect, detach, and cancel DSH sessions.
- Deliver final assistant text after each Telegram-originated turn, with Unicode-safe bounded chunking.
- Persist Telegram update offsets before mutations for at-most-once remote command admission.
- Restrict sessions to Telegram-created sessions by default; optionally enable access to all ordinary root sessions locally.
- Reject groups, channels, bot messages, edited messages, stale updates, subagent sessions, DSH slash commands, remote approvals, attachments, and raw tool events.
- Rate-limit pairing, commands, prompts, history reads, and session creation.
- Fail closed when another poller or webhook owns the bot.

## Install

Install from this repository or the `dsh-plugins-extra` npm installer. Do not run `dsh plugin add dsh-telegram` — that npm name belongs to an unrelated third-party plugin.

From this repository:

```sh
npm install
dsh-plugins-extra install telegram --profile web
```

Restart DSH, then:

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Open **Settings → Telegram**.
3. Paste the token and select **Verify and save**.
4. Enable long polling.
5. Generate a pairing code locally.
6. Open the bot's private chat and send `/pair CODE`.
7. Send `/new My project` and then any normal text prompt.

If the bot already has a webhook, DSH refuses to take it over automatically. Use the explicit **Clear webhook and retry** action in local settings if that is intentional.

## Telegram commands

| Command | Action |
| --- | --- |
| `/help` | Show the safe remote command surface |
| `/whoami` | Show the paired Telegram user and chat IDs |
| `/new [title]` | Create and select a new DSH session |
| `/sessions` | List sessions this paired identity may access |
| `/use <prefix>` | Select one unambiguous session ID prefix |
| `/ask <message>` | Queue a prompt; ordinary text is equivalent |
| `/steer <message>` | Steer an active turn when enabled locally |
| `/history [1-20]` | Show visible user and final assistant text only |
| `/rename <title>` | Rename the selected session |
| `/cancel` | Request cancellation of the active turn |
| `/detach` | Clear the selected session without deleting it |
| `/status` | Show bot, access-policy, and session state |

Telegram never forwards arbitrary `/...` text to DSH's slash-command registry.

## Access modes

The default policy exposes only sessions created by the same paired Telegram identity. This prevents accidental access to privileged or unrelated local conversations.

To control existing DSH sessions, enable **Allow access to existing root sessions** in local Telegram settings. This is a high-trust mode: the paired identity can read visible history and submit prompts to every ordinary root session. Subagent sessions remain excluded.

An optional default project directory and agent preset can be assigned to Telegram-created sessions. For least privilege, create a restricted DSH agent preset and enter its ID in the settings page.

## Security boundary

A Telegram prompt runs with the capabilities of the selected DSH session and its agent preset. Pair only accounts you fully trust. Tool approvals remain owned by DSH and are not relayed or bypassed by this plugin.

See [SECURITY.md](./SECURITY.md) for the threat model, hardening details, incident response, and limitations.

## Development

```sh
npm test --workspace dsh-telegram
npm pack --dry-run --workspace dsh-telegram
```

The transport uses native Node.js `fetch` and has no third-party runtime dependencies.
