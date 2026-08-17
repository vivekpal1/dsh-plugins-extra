# Security policy

Please report vulnerabilities privately through GitHub Security Advisories after this repository is published. Do not include access tokens, OAuth callbacks, account IDs, private session transcripts, or credential-store contents in an issue.

The importer reads only local Codex and Claude Code session stores requested by UUID. It records source identifiers, source fingerprints, and omission counts but never transcript text in its duplicate registry. The themes plugin stores only a theme identifier. Both plugins expose browser RPC handlers with loopback authority.

The Solana wallet is experimental and unaudited. It starts on devnet, encrypts the recovery phrase before credential storage, never exposes signing secrets to agent tools, and requires a DSH approval for every session transfer. Do not report a recovery phrase or private key in an issue.

The CLI installs only package builds bundled inside its own integrity-checked npm package. Package names and DSH profiles are allowlisted or validated, child processes receive argument arrays without shell interpolation, and installation is verified from DSH's effective config.

For vulnerabilities in the mirrored Codex subscription package, follow its package-level [`SECURITY.md`](packages/dsh-codex-subscription/SECURITY.md) and report directly to the upstream maintainer.
