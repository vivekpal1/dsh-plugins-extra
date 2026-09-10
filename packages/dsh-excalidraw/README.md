# dsh-excalidraw

A live **Excalidraw** tab for DeepSeek Harness web sessions, plus three compact agent tools that draw, inspect, and export the same canvas.

The agent does not drive 26 MCP element tools or round-trip screenshots. One `excalidraw_apply` call can create a whole diagram; the tab is the visual surface.

## What it does

- Adds an **Excalidraw** tab to the conversation view (registered into `conversation.view` with `order: 30`, after Trajectory and Terminal).
- Keeps one scene per conversation session. Agent edits appear live; dragging shapes in the tab writes back to the host.
- Persists `.dsh/excalidraw/canvas.excalidraw` in the session project directory. Files open in Excalidraw.
- Serves the canvas assets from the plugin host route (`/dsh-excalidraw-assets`). Nothing is fetched from a third-party CDN.

## Install

```sh
dsh-plugins-extra install excalidraw
```

Restart DSH, then open a conversation and pick the **Excalidraw** tab.

## Agent tools

| Tool | Role |
| --- | --- |
| `excalidraw_apply` | Batch upsert / connect / delete / clear. Omit `x`/`y` to auto-layout. |
| `excalidraw_scene` | Compact inventory: `id`, `type`, `label`, bounds. No images. |
| `excalidraw_export` | Write an `.excalidraw` file inside the session workspace. |

Example apply payload:

```json
{
  "ops": [
    { "op": "upsert", "id": "web", "type": "rectangle", "label": "Web" },
    { "op": "upsert", "id": "api", "type": "rectangle", "label": "API" },
    { "op": "upsert", "id": "db", "type": "rectangle", "label": "DB" },
    { "op": "connect", "from": "web", "to": "api" },
    { "op": "connect", "from": "api", "to": "db", "label": "SQL" }
  ]
}
```

Drop an existing `.excalidraw` file onto the tab to load it.

## Safety

The RPC channel is loopback-only (`authority: "loopback"`), so only the local web UI can reach the canvas. Export paths are confined to the session workspace. The plugin does not execute diagram contents as code.

## Architecture

| Half | File | Role |
| --- | --- | --- |
| Host | `lib/scene.js` | Skeleton ops → Excalidraw elements, compact inventory, path-safe export |
| Host | `lib/store.js` | Per-session scene, autosave, optimistic writes |
| Host | `lib/index.js` | Loopback RPC `/dsh-excalidraw`, asset route, three agent tools |
| Browser | `lib/client.js` | Conversation tab hosting the local canvas iframe |
| Browser | `lib/assets/` | SVG canvas view (pan, zoom, drag, file drop) |

## License

MIT. See `THIRD_PARTY_NOTICES.md` for the Excalidraw format note.
