# Changelog

## 0.7.0 - 2026-09-10

- Added `dsh-excalidraw`, a conversation-tab canvas with three compact agent tools (`excalidraw_apply`, `excalidraw_scene`, `excalidraw_export`) instead of a 26-tool MCP catalog or screenshot round-trips.
- Scenes persist as `.excalidraw` files in the session workspace, stay loopback-RPC-only, and can be dropped onto the tab or opened in Excalidraw.

## 0.6.4 - 2026-08-24

- Stop dumping compressed PDF binary into the DSH transcript. Scanned or Flate-encoded PDFs are saved to disk and the model is told to read the original file.

## 0.6.3 - 2026-08-24

- Telegram polling steals a lock left by a dead DSH process and retries if a restart loses the lease, so messages keep flowing after DSH is relaunched.

## 0.6.2 - 2026-08-24

- Telegram shows a typing indicator while downloading a file, asks for a resend if a document arrives stale, and tells the model when a PDF has no extractable text (scanned e-visas).

## 0.6.1 - 2026-08-23

- Telegram no longer sends an "Accepted in …" receipt after each prompt; only the assistant reply (and generated files) come back.
- Added `/model` to list and change the selected session model from a paired chat.

## 0.6.0 - 2026-08-23

- Telegram accepts photos, PDFs, Office documents, and other files from a paired private chat, saves originals into `.dsh/telegram-inbox/`, and forwards images plus extracted text to DSH.
- Telegram sends generated PDFs, spreadsheets, documents, and images back when the agent writes them to `.dsh/telegram-outbox/` during a Telegram-originated turn.
- File downloads are capped at 20 MB, filenames are sanitized, and bot-token values stay out of API error messages.

## 0.5.0 - 2026-08-22

- Added `dsh-telegram`, an outbound-only Telegram Bot API bridge for creating, selecting, prompting, inspecting, renaming, and cancelling DSH sessions from a paired private chat.
- Added DSH credential-backed token storage, local one-time pairing, exact user/chat authorization, scoped session ACLs, durable at-most-once update admission, stale-update rejection, bounded output, and layered rate limits.
- Added a polished Telegram settings page for bot verification, polling health, pairing, revocation, project/preset policy, and explicit high-trust existing-session access.
- Added `dsh-terminal`, an xterm.js conversation tab backed by a persistent per-session PTY in the session project directory.
- Added tests, package verification, installer catalog entries, security documentation, and root-package distribution files for both extensions.

## 0.4.0 - 2026-08-17

- Enabled the current official Solana mainnet RPC endpoint while keeping devnet as the default and persisting an explicit mainnet acknowledgement.
- Bound every reviewed transfer to its exact network, rejected concurrent sends, and made locked-wallet guidance visible to session agents without exposing passwords or seed phrases.
- Pinned GitHub Actions to immutable commits, disabled dependency lifecycle scripts in CI, removed persisted checkout credentials, and prepared trusted npm publishing with provenance.
- Documented the installer capabilities that package scanners correctly detect and verified that the root npm package has no runtime dependencies or install scripts.

## 0.3.1 - 2026-08-17

- Replaced repeated raw pnpm output with a compact install plan, one verified status per extension, and a clear completion summary.
- Added installed-version detection so current extensions are skipped instead of being reinstalled.
- Preserved package-manager diagnostics behind `--verbose` and prevented accidental downgrades when a newer extension is already present.

## 0.3.0 - 2026-08-17

- Added the publishable `dsh-plugins-extra` CLI with independent, multi-package, dry-run, list, verify, doctor, and uninstall commands.
- Bundled the reviewed repository packages into the CLI distribution so similarly named third-party npm packages are never substituted.
- Added explicit adoption disclosures for credential, context-provenance, self-custody, and reversible-interface extensions.
- Upgraded session import provenance with omission counts, a versioned atomic registry, source fingerprints, serialized registry updates, and concurrent duplicate prevention.

## 0.2.0 - 2026-08-17

- Added `dsh-solana-wallet`, an encrypted self-custodial Solana wallet for DSH settings and sessions.
- Added wallet creation and BIP39 import at `m/44'/501'/0'/0'`, receive addresses, native SOL balances, recent transaction history, locking, recovery, and native SOL transfers.
- Added AES-256-GCM encryption with a memory-hard scrypt password key, five-minute in-memory auto-locking, devnet-by-default network safety, and mandatory DSH one-time approval for every session transfer.

## 0.1.1 - 2026-08-17

- Added distinct Codex sparkle, session import, and theme palette icons to the DSH settings sidebar.
- Added a lifecycle-safe compatibility shim for DSH rc.6, whose settings section API does not yet accept custom icons.

## 0.1.0 - 2026-08-17

- Added the Codex subscription v0.3.1 upstream mirror.
- Added Codex and Claude Code session importing with duplicate protection.
- Added Catppuccin Mocha, Gruvbox Dark, Nord, Tokyo Night, and Dracula themes.
- Added tarball-based installation, verification, tests, and CI.
