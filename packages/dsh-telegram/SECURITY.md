# dsh-telegram security policy

## Threat model

This plugin crosses a high-risk boundary: authenticated Telegram messages can become prompts inside a local DSH session. A compromised bot token, paired Telegram account, selected agent preset, or local DSH profile may therefore expose conversation text or trigger tools available to that session.

## Security design

- **Outbound-only transport:** long polling opens no inbound port.
- **Credential isolation:** `DSH_TELEGRAM_BOT_TOKEN` is resolved per operation through DSH credentials. The token is never returned to the client UI or agent.
- **Deny by default:** an empty principal list authorizes nobody.
- **Local pairing approval:** the one-time code is generated only through loopback DSH settings RPC, contains 40+ random bits, expires in five minutes, is single-use, and is rate-limited.
- **Exact identity binding:** authorization requires the stored numeric Telegram `user_id` and private `chat_id`; usernames are display-only.
- **Private chats only:** groups, supergroups, channels, bot-authored messages, and edited messages are ignored.
- **Session ACL:** Telegram-created sessions are scoped to their creating principal by default. Access to existing root sessions is an explicit local risk setting. Subagent sessions are never exposed.
- **At-most-once admission:** each Telegram update ID is persisted before executing a mutation. A crash can drop a reserved command but will not replay a possibly executed prompt.
- **Freshness:** messages older than two minutes are rejected.
- **Bounded input/output:** prompts are limited to 4,000 code points and 8 KiB. Responses use plain text, 3,500 UTF-16-unit chunks, and at most eight chunks.
- **No privilege shortcuts:** remote DSH slash commands, tool approvals, credentials, attachments, raw event JSON, and tool results are not exposed.
- **Rate limiting:** pairing is limited to 5/hour; authenticated commands to 10/minute; prompts to 3/minute; history to 6/minute; and session creation to 2/hour per principal.
- **Polling ownership:** a configured webhook fails closed. Telegram conflict and throttling responses are handled without logging the token.
- **Log minimization:** logs contain action-level failure classes, never tokens, pairing codes, prompts, responses, usernames, or tool payloads.

## Operational recommendations

1. Create a dedicated Telegram bot used only for DSH.
2. Pair only a private Telegram account protected by two-factor authentication.
3. Keep access to existing root sessions disabled unless needed.
4. Assign a least-privilege DSH agent preset to Telegram-created sessions.
5. Keep tool approvals enabled for external side effects and financial actions.
6. Revoke lost devices immediately in **Settings → Telegram** and rotate the BotFather token.
7. Disable the integration when it is not needed.

## Known limitations

- Telegram and its infrastructure can observe message contents and metadata. Do not transmit secrets through the bot.
- The update offset and ACL state use the configured DSH settings provider; protect that local file as part of the DSH profile.
- If DSH crashes after reserving an update but before executing it, the command is intentionally dropped rather than replayed.
- Responses initiated outside Telegram are not broadcast. Only turns containing a prompt admitted by this plugin receive Telegram delivery.
- Rich media, files, remote approval prompts, and tool event streaming are intentionally unsupported.

## Reporting vulnerabilities

Do not open a public issue containing tokens, chat IDs, private prompts, or exploit details. Contact the repository owner privately through the security contact listed on the GitHub repository, then rotate any potentially exposed token.
