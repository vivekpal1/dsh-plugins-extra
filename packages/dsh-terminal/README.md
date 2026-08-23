# dsh-terminal

An interactive **Terminal** tab for DeepSeek Harness web sessions. It appears in the conversation view header right next to **Chat Trajectory** and opens a real shell in the current session's project directory (`session.header.cwd`).

## What it does

- Adds a **Terminal** tab to the conversation view tab bar (registered into the `conversation.view` slot with `order: 20`, directly after Trajectory at `order: 10`).
- Runs one persistent shell per conversation session: switching tabs never kills your running commands, and returning to the tab replays recent output.
- Uses a real pseudoterminal via `node-pty` (prebuilt native module) so interactive programs, job control, and resize all work. On platforms where the native module cannot load, it falls back to DSH's own `ctx.subprocess.spawnTerminal` PTY seam (fixed initial size).
- Renders with xterm.js. The xterm browser assets (`/dsh-terminal-assets/xterm.js`, `xterm.css`, `xterm-addon-fit.js`) are served by the plugin's host half, so nothing is fetched from third-party CDNs.

## Install

```sh
dsh-plugins-extra install terminal
```

Restart DSH, then open a conversation and pick the **Terminal** tab next to Trajectory.

## Use

- Type commands exactly as in a local terminal (Ctrl+C, arrows, tab completion, `vim`, `htop`, `npm run dev` all work through the PTY).
- The toolbar shows the shell's working directory and pid. **Close terminal** kills the shell; **New terminal** starts a fresh one.
- One shell is kept per conversation session and closes itself after 15 minutes of inactivity.

## Safety

The terminal runs commands as the local user in the session's project directory — the same trust boundary as DSH's own bash tooling. The RPC channel is loopback-only (`authority: "loopback"`), so only the local web UI can reach it. Anything you type can run with your user's permissions; do not paste secrets you would not type in a normal terminal.

## Architecture

| Half | File | Role |
| --- | --- | --- |
| Host | `lib/index.js` | Loopback RPC `/dsh-terminal` (`open` / `write` / `read` / `resize` / `close`), per-session shell lifecycle, bounded output ring, xterm asset route |
| Host | `lib/output-ring.js` | Bounded, offset-based output buffer so tab switches and reconnects resume without gaps |
| Browser | `lib/client.js` | xterm.js view registered into the `conversation.view` slot; polls `read` for output and forwards input/resize |

## License

MIT. xterm.js and xterm-addon-fit are MIT; node-pty is MIT — see `THIRD_PARTY_NOTICES.md`.
