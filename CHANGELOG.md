# Changelog

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
