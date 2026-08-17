# DSH Session Import

Import local Codex and Claude Code conversations into DeepSeek Harness as resumable DSH sessions.

- Codex source: `~/.codex/sessions` and `~/.codex/archived_sessions`
- Claude Code source: `~/.claude/projects`
- Imported content: visible human and assistant text
- Excluded content: system/developer prompts, reasoning, token events, and raw tool calls/results

## Install

From the repository root:

```sh
./scripts/install.sh import
```

Restart DSH, open **Settings → Import**, choose a source, enter its session UUID, and import. Imports are recorded in `~/.dsh/session-imports.json` to prevent accidental duplicates.

## Privacy and behavior

The importer reads only local session files matching the requested UUID and exposes its RPC handler only to DSH's loopback browser connection. It never modifies the source transcript. Tool calls are excluded because provider-specific tool state cannot be resumed safely across harnesses; visible user and assistant text remains available as model context.
