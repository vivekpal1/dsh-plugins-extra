# DSH Session Import

Import local Codex and Claude Code conversations into DeepSeek Harness as resumable DSH sessions with explicit source provenance.

- Codex source: `~/.codex/sessions` and `~/.codex/archived_sessions`
- Claude Code source: `~/.claude/projects`
- Imported content: visible human and assistant text
- Excluded content: system/developer prompts, reasoning, token events, raw tool calls/results, Claude sidechains, and unsupported blocks

## Install

From the repository root:

```sh
./scripts/install.sh import
```

Restart DSH, open **Settings → Import**, choose a source, enter its session UUID, and import. The result reports the visible message count and every omitted content category without exposing the omitted content itself.

Imports are recorded in `~/.dsh/session-imports.json` by source and source-session UUID. Concurrent requests for the same source share one operation, registry updates are serialized, and the registry is written atomically with user-only permissions to prevent accidental duplicates.

## Privacy and behavior

The importer reads only local session files matching the requested UUID and exposes its RPC handler only to DSH's loopback browser connection. It never modifies the source transcript. Tool calls are excluded because provider-specific tool state cannot be resumed safely across harnesses; visible user and assistant text remains available as model context. Each registry record includes the source, source-session UUID, importer schema version, and a SHA-256 fingerprint of the source file.
