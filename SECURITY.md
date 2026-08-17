# Security policy

Please report vulnerabilities privately through GitHub Security Advisories after this repository is published. Do not include access tokens, OAuth callbacks, account IDs, private session transcripts, or credential-store contents in an issue.

The importer reads only local Codex and Claude Code session stores requested by UUID. It records source identifiers, source fingerprints, and omission counts but never transcript text in its duplicate registry. The themes plugin stores only a theme identifier. Both plugins expose browser RPC handlers with loopback authority.

The Solana wallet is experimental and unaudited. It starts on devnet, encrypts the recovery phrase before credential storage, never exposes signing secrets to agent tools, and requires a DSH approval for every session transfer. Do not report a recovery phrase or private key in an issue.

Mainnet remains disabled unless its acknowledgement is stored by the wallet settings flow. Every transfer is bound to the network shown during review, simulated before signing, serialized to prevent concurrent sends, and submitted with RPC preflight enabled. The bundled public RPC is suitable for personal and evaluation traffic, but it is rate-limited; high-volume use should wait for configurable dedicated RPC support.

## Published-package security

The root npm package has no runtime dependencies or lifecycle scripts. Its installer needs filesystem access to pack the reviewed plugin sources shipped inside the npm tarball and shell-free child-process access to invoke `npm` and `dsh`; those capabilities are expected and are not used to download plugin code from arbitrary package names.

Release automation installs dependencies with lifecycle scripts disabled, pins GitHub Actions to full commit hashes, avoids persisted checkout credentials, and publishes through npm trusted publishing with provenance. Configure the npm trusted publisher for `vivekpal1/dsh-plugins-extra` and `.github/workflows/release.yml` before creating the next release tag.

The CLI installs only package builds bundled inside its own integrity-checked npm package. Package names and DSH profiles are allowlisted or validated, child processes receive argument arrays without shell interpolation, and installation is verified from DSH's effective config.

For vulnerabilities in the mirrored Codex subscription package, follow its package-level [`SECURITY.md`](packages/dsh-codex-subscription/SECURITY.md) and report directly to the upstream maintainer.
