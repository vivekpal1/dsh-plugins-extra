# Security policy

Please report vulnerabilities privately through GitHub Security Advisories after this repository is published. Do not include access tokens, OAuth callbacks, account IDs, private session transcripts, or credential-store contents in an issue.

The importer reads only local Codex and Claude Code session stores requested by UUID. The themes plugin stores only a theme identifier. Both plugins expose browser RPC handlers with loopback authority.

For vulnerabilities in the mirrored Codex subscription package, follow its package-level [`SECURITY.md`](packages/dsh-codex-subscription/SECURITY.md) and report directly to the upstream maintainer.
