# DSH Plugins Extra

`dsh-plugins-extra` is a small npm CLI and curated extension collection for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It installs each extension independently, verifies the resulting DSH profile, and keeps the security boundary of every adoption decision visible.

## Packages

| Install name | Adoption decision | Purpose | Status |
| --- | --- | --- | --- |
| `codex` | Credentials and model provider | ChatGPT/Codex subscription authentication and provider integration | Upstream mirror of `WSL043/dsh-codex-subscription` v0.3.1 |
| `import` | Context provenance | Import visible Codex and Claude Code conversations into DSH | Maintained here |
| `wallet` | Self-custody and transactions | Encrypted self-custodial Solana wallet and approved session tools | Experimental, unaudited |
| `themes` | Reversible interface | Catppuccin, Gruvbox, Nord, Tokyo Night, and Dracula palettes | Maintained here |

These packages are deliberately not presented as one trust decision. The CLI prints the relevant disclosure before installing each package, and users can list, verify, install, or remove any combination.

### Settings icons

DSH rc.6 does not expose an icon property for third-party settings sections; its shell assigns a gear to every unknown section ID. These packages use a small client-side compatibility shim to replace only their own fallback SVGs with semantic icons while preserving DSH's classes, `currentColor`, keyboard behavior, and accessible text. The shim observes settings-dialog remounts, restores the original SVG when a plugin unloads, and does not modify the installed DSH package.

## Install

Requirements: Node.js 24+, npm, and a working `dsh` command.

```sh
npm install --global dsh-plugins-extra
dsh-plugins-extra list
dsh-plugins-extra install import themes
```

Multiple package names can follow one install command, and `all` installs the complete collection:

```sh
dsh-plugins-extra install codex wallet themes
dsh-plugins-extra install all --profile web
dsh-plugins-extra update import themes
dsh-plugins-extra verify
dsh-plugins-extra doctor
dsh-plugins-extra uninstall wallet
```

Normal installs show a compact plan and one verified result per extension. Already-current versions are skipped, newer versions are never downgraded, and known DSH host-peer warnings stay out of the success path. Add `--verbose` when troubleshooting to stream the underlying package-manager output.

One-off use through npm works as well:

```sh
npx dsh-plugins-extra@latest install import themes
```

The npm package contains the exact reviewed plugin builds from this repository. The CLI packs those builds locally into `$DSH_HOME/packages`, passes argument arrays directly to DSH without shell interpolation, and verifies that each plugin appears exactly once. It never substitutes similarly named third-party npm packages. The default profile is `web`; use `--profile name` or `DSH_PROFILE=name` for another profile.

Restart DSH after installation, then use:

- **Settings → Codex Subscription** to authenticate.
- **Settings → Import** to import a Codex or Claude Code session UUID.
- **Settings → Wallets** to create or import an encrypted Solana wallet.
- **Settings → Themes** to choose a community palette.

### Solana wallet safety

The wallet starts on Solana devnet and currently supports native SOL only. Its BIP39 recovery phrase is encrypted with AES-256-GCM using a scrypt-derived password key before storage, while decrypted signing material remains only in host memory and auto-locks after five minutes. Recovery phrases never enter agent context or tool results, and session transfers pass through DSH's native one-time approval prompt with the exact recipient and amount.

This wallet plugin is experimental and has not received an independent security audit. Keep an offline recovery backup, test on devnet, and use only small balances until the implementation has been reviewed externally.

The installer never restarts DSH, deletes profiles, signs users out, or touches saved credentials. `--dry-run` previews installation or removal without changing the DSH profile.

The npm package itself has no runtime dependencies or install scripts. The CLI invokes `npm pack` only against plugin sources bundled in the installed tarball, then invokes `dsh plugin add` without a shell; it never resolves a plugin alias to an arbitrary registry package. These expected filesystem and child-process capabilities may appear in package scanners because they are required to install local DSH bundles.

### Import provenance and duplicate behavior

The importer carries visible user and assistant text into DSH. It excludes injected system context, hidden reasoning, raw tool activity, Claude sidechains, and unsupported content because that provider-specific state cannot be resumed safely. Every result reports visible-message and omission counts, plus the source kind, source-session UUID, importer schema version, and a SHA-256 source fingerprint.

Exact duplicate imports are prevented by a private local registry keyed by source and source-session UUID. Concurrent requests for one source share a single operation; registry updates are serialized, atomically replaced, and stored with user-only permissions. The registry never contains transcript text.

## Development

```sh
npm install
npm test
npm run pack:check
node ./bin/dsh-plugins-extra.js doctor
```

Node tests cover CLI selection and multi-package installation, import provenance and concurrency, deterministic Solana derivation, encryption, signing, transfer construction, and approval enforcement. The Codex subscription package retains its upstream test and build suite. GitHub Actions runs the workspace checks on Linux and macOS.

## Provenance and licenses

`dsh-codex-subscription` is copied from upstream tag `v0.3.1` at commit `34b0fdd0783d1150351385eb727e402bcbdaf847`. Its MIT license, author metadata, security policy, and third-party notices remain inside that package. This workspace adds the settings-icon compatibility shim to the client bundle; functional provider changes should still be synchronized from upstream and clearly documented.

The session importer, Solana wallet integration, theme integration, repository tooling, and documentation are MIT licensed. Theme names and palettes belong to their respective open-source communities; this repository is not affiliated with those projects, DeepSeek, Anthropic, OpenAI, or Solana Foundation.
