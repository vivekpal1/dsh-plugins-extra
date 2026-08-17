# Security review: dsh-plugins-extra

Date: 2026-08-17  
Mode: Daily, 8/10 confidence gate  
Scope: npm installer, bundled DSH plugins, CI/release chain, and Solana wallet mainnet path

## Summary

No critical or high-severity vulnerability was confirmed. Four medium findings and one low finding were verified: four are fixed in 0.4.0, while npm provenance remains pending until the repository workflow is registered as this package's trusted publisher on npm.

The Socket overview page returned bot-protection HTTP 403 to the audit environment, so the exact npm 0.3.0 and 0.3.1 artifacts were independently inspected from the npm registry. The root tarball has 47 files, no runtime dependencies, no lifecycle scripts, a valid registry signature, and an npm audit result of zero known vulnerabilities. Filesystem and child-process capabilities are expected because the CLI packs bundled local plugin sources and invokes `dsh` with shell execution disabled.

## Architecture and attack surface

| Component | Entry point | Trust boundary | Main controls |
| --- | --- | --- | --- |
| Installer CLI | Local command arguments and environment | User process to npm and DSH child processes | Strict alias/profile validation, fixed local catalog, `shell: false`, post-install config verification |
| Codex provider | Loopback DSH RPC and OpenAI HTTPS APIs | Browser, host plugin, OAuth provider | Loopback authority, fixed OpenAI auth origin, redacted public errors, DSH credential store |
| Session importer | Loopback DSH RPC and local Codex/Claude files | Browser to host filesystem | UUID validation, fixed roots, omission policy, SHA-256 provenance, duplicate registry |
| Themes | Loopback DSH RPC and local preference file | Browser to local settings | Fixed theme allowlist, atomic mode-0600 write |
| Solana wallet | Loopback DSH RPC, session tools, Solana RPC | Browser/agent to encrypted seed and blockchain | AES-256-GCM, scrypt, five-minute lock, mainnet acknowledgement, simulation, approval, preflight, exact network binding |
| Release workflow | Git tags, npm registry, GitHub Releases | Repository to public distribution | Immutable action pins, ignored lifecycle scripts, no persisted checkout credential, OIDC provenance workflow |

No network listener is created by this repository. Browser-facing handlers use DSH's loopback-only connection authority. No committed live secrets, private keys, token values, credential files, or executable custom Git hooks were found in the current tree or targeted history scan.

## Findings and remediation

### [MEDIUM] DSH-SEC-001: Reviewed transfer network was not bound to execution

**Confidence:** 9/10  
**Category:** OWASP A04 / STRIDE Tampering  
**Status:** Fixed in wallet 0.2.0

An approved transfer previously selected the active network again during execution. A network change between preview and execution could make the signed transaction target a different cluster than the one shown for review. The send tool and settings RPC now carry `expectedNetwork`; execution fails before any RPC call when it differs from the effective network.

### [MEDIUM] DSH-SEC-002: Mainnet acknowledgement was not part of persisted authorization state

**Confidence:** 9/10  
**Category:** OWASP A01 / STRIDE Elevation of Privilege  
**Status:** Fixed in wallet 0.2.0

The UI required acknowledgement before selecting mainnet, but only the network value was stored. Direct modification or migration of settings could retain mainnet without evidence of acknowledgement. Mainnet is now effective only when `network: mainnet-beta` and `mainnetEnabled: true` are stored together by the acknowledged settings RPC; otherwise the wallet fails safe to devnet.

### [MEDIUM] DSH-SEC-003: CI actions used mutable major-version tags

**Confidence:** 10/10  
**Category:** OWASP A08 / STRIDE Tampering  
**Status:** Fixed in 0.4.0

Both workflows referenced `actions/checkout@v7` and `actions/setup-node@v7`. A moved or compromised tag could alter release code. Both actions are now pinned to verified full commit hashes, checkout credentials are not persisted, jobs have timeouts, and dependency lifecycle scripts are disabled during CI installation.

### [MEDIUM] DSH-SEC-004: Published releases lack source provenance attestations

**Confidence:** 10/10  
**Category:** OWASP A08 / Supply chain  
**Status:** Workflow fixed; npm registry configuration pending

Versions 0.3.0 and 0.3.1 have npm registry signatures but no Sigstore provenance attestation linking their build to this repository. The release workflow now publishes through npm OIDC trusted publishing with `id-token: write`. Before tagging 0.4.0, npm must register `vivekpal1/dsh-plugins-extra` and `.github/workflows/release.yml` as the package's trusted publisher.

### [LOW] DSH-SEC-005: Concurrent host RPC sends were not serialized

**Confidence:** 8/10  
**Category:** OWASP A04 / STRIDE Repudiation  
**Status:** Fixed in wallet 0.2.0

DSH marks the agent tool non-concurrent and the settings UI disables duplicate clicks, but direct concurrent loopback RPC calls could prepare two transfers while the wallet was unlocked. The wallet service now permits one send operation at a time and fails additional sends before preparation.

## STRIDE and data classification

| Component | Primary threat | Risk after remediation | Mitigation |
| --- | --- | --- | --- |
| Installer | Tampered package source | Low | npm integrity/signature, fixed bundled catalog, shell-free execution, planned provenance |
| Importer | Context spoofing or duplication | Low | Fixed source roots, UUID validation, fingerprinting, serialized duplicate registry |
| Wallet vault | Seed disclosure | Medium | Encrypted credential payload, authenticated encryption, scrypt, no agent exposure, auto-lock |
| Wallet send | Wrong or duplicate transaction | Medium | Exact network/recipient/amount approval, unsigned simulation, one-send lock, signature check, confirmation |
| Public RPC | Availability or misleading response | Medium | HTTPS fixed endpoint, locally deterministic signing, preflight and signature verification; public endpoint remains rate-limited |

The recovery phrase and OAuth tokens are credentials; they are stored through DSH credentials, with the wallet phrase additionally encrypted before storage. Wallet addresses, balances, signatures, and imported visible conversation text are user data but not signing secrets. Recovery phrases are transmitted only over DSH's loopback settings RPC for create/import/reveal and are never returned by agent tools.

## Verification

- Full test suite: passed, including 16 wallet tests.
- Dependency audit: 0 known vulnerabilities across 393 installed dependencies.
- Registry verification: 385 verified signatures and 125 verified attestations in the installed dependency graph.
- Root npm artifact: 47 allowlisted files, no runtime dependencies, and no install lifecycle scripts.
- Mainnet no-broadcast check: official RPC health and genesis hash verified, current blockhash retrieved, fee calculated, and unsigned simulation executed; no `sendTransaction` call was made.
- DSH runtime: wallet 0.2.0 installed in profile `web`, DSH restarted, and `http://127.0.0.1:3080/` returned HTTP 200.

## Confidence calibration

- Total findings: 5
- Critical: 0
- High: 0
- Medium: 4, average confidence 9.5/10
- Low: 1, confidence 8/10
- Info: 0
- False positives filtered: 7, including static SVG `innerHTML`, test mnemonics, local HTTP, expected filesystem access, expected child-process access, source maps, and development warnings
- Mode: Daily, 8/10 gate

