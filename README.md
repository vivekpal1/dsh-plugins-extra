# DSH Plugins Extra

Community extensions for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), organized as an npm workspace and installable into a local DSH web profile.

## Packages

| Package | Purpose | Status |
| --- | --- | --- |
| [`dsh-codex-subscription`](packages/dsh-codex-subscription) | ChatGPT/Codex subscription authentication and provider integration | Upstream mirror of `WSL043/dsh-codex-subscription` v0.3.1 |
| [`dsh-session-import`](packages/dsh-session-import) | Import visible Codex and Claude Code conversations into DSH | Maintained here |
| [`dsh-solana-wallet`](packages/dsh-solana-wallet) | Encrypted self-custodial Solana wallet and approved session tools | Experimental, unaudited |
| [`dsh-themes`](dsh-themes) | Catppuccin, Gruvbox, Nord, Tokyo Night, and Dracula palettes | Maintained here |

### Settings icons

DSH rc.6 does not expose an icon property for third-party settings sections; its shell assigns a gear to every unknown section ID. These packages use a small client-side compatibility shim to replace only their own fallback SVGs with semantic icons while preserving DSH's classes, `currentColor`, keyboard behavior, and accessible text. The shim observes settings-dialog remounts, restores the original SVG when a plugin unloads, and does not modify the installed DSH package.

## Install

Requirements: Node.js 24+, npm, and a working `dsh` command.

```sh
git clone https://github.com/vivekpal1/dsh-plugins-extra.git
cd dsh-plugins-extra
./scripts/install.sh all
```

Install one package with `codex`, `import`, `wallet`, or `themes` instead of `all`. The installer keeps immutable tarballs under `$DSH_HOME/packages` before adding them to the selected DSH profile, avoiding fragile workspace links and temporary-file dependencies. It defaults to the `web` profile; override it with `DSH_PROFILE=name`.

Restart DSH after installation, then use:

- **Settings → Codex Subscription** to authenticate.
- **Settings → Import** to import a Codex or Claude Code session UUID.
- **Settings → Wallets** to create or import an encrypted Solana wallet.
- **Settings → Themes** to choose a community palette.

### Solana wallet safety

The wallet starts on Solana devnet and currently supports native SOL only. Its BIP39 recovery phrase is encrypted with AES-256-GCM using a scrypt-derived password key before storage, while decrypted signing material remains only in host memory and auto-locks after five minutes. Recovery phrases never enter agent context or tool results, and session transfers pass through DSH's native one-time approval prompt with the exact recipient and amount.

This wallet plugin is experimental and has not received an independent security audit. Keep an offline recovery backup, test on devnet, and use only small balances until the implementation has been reviewed externally.

The installer never restarts DSH, deletes profiles, signs users out, or touches saved credentials.

## Development

```sh
npm install
npm test
./scripts/verify.sh
```

Node tests cover the locally maintained plugins, including deterministic Solana derivation, encryption, signing, transfer construction, and approval enforcement. The Codex subscription package retains its upstream test and build suite. GitHub Actions runs the workspace checks on Linux and macOS.

## Provenance and licenses

`dsh-codex-subscription` is copied from upstream tag `v0.3.1` at commit `34b0fdd0783d1150351385eb727e402bcbdaf847`. Its MIT license, author metadata, security policy, and third-party notices remain inside that package. This workspace adds the settings-icon compatibility shim to the client bundle; functional provider changes should still be synchronized from upstream and clearly documented.

The session importer, Solana wallet integration, theme integration, repository tooling, and documentation are MIT licensed. Theme names and palettes belong to their respective open-source communities; this repository is not affiliated with those projects, DeepSeek, Anthropic, OpenAI, or Solana Foundation.
