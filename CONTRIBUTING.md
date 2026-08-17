# Contributing

Use Node.js 24 or newer and keep each plugin independently packable. Before opening a pull request:

```sh
npm install
npm run check
```

Keep DSH host RPC handlers loopback-only, validate every filesystem-facing identifier, and never log credentials, authorization callbacks, account identifiers, hidden prompts, or raw imported tool payloads.

The `dsh-codex-subscription` directory tracks an external upstream. Preserve its author and license metadata, and identify the upstream tag and commit in any synchronization pull request.
