/**
 * dsh-terminal server half.
 *
 * Runs a persistent interactive shell per conversation session, bridged to the
 * web client over the loopback RPC channel `/dsh-terminal`. The shell starts in
 * the session's working directory (`session.header.cwd`), i.e. the project
 * directory the conversation was opened in.
 *
 * PTY transport: `node-pty` (native, prebuilt) is used when available so the
 * terminal is a real pseudoterminal with resize, job control, and interactive
 * programs. On platforms where the native module cannot load, the harness's
 * own `ctx.subprocess.spawnTerminal` seam is used instead (fixed initial size).
 *
 * The same route also serves the xterm.js browser assets (`/dsh-terminal-assets`),
 * so the client bundle stays dependency-free.
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { OutputRing } from "./output-ring.js";

export const name = "dsh-terminal";
export const inject = ["sessions", "connection", "webServer", "subprocess"];

const CHANNEL = "/dsh-terminal";
const ASSET_ROOT = "/dsh-terminal-assets";
const RING_MAX_UNITS = 1024 * 1024;
const REPLAY_MAX_UNITS = 64 * 1024;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_COLS = 40;
const MAX_COLS = 500;
const MIN_ROWS = 10;
const MAX_ROWS = 200;
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;

/** sessionId -> record (one shell per conversation session). */
const terminals = new Map();
/** terminalId -> record. */
const byId = new Map();
let nextId = 0;

function clampInt(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function defaultShell() {
  const env = process.env.SHELL;
  if (env && env.trim() !== "") return env.trim();
  return process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/bash";
}

function armIdle(record) {
  if (record.idleTimer) clearTimeout(record.idleTimer);
  const tick = () => {
    if (record.closed || record.closing) return;
    if (Date.now() - record.lastActive >= IDLE_TIMEOUT_MS) {
      closeRecord(record, "idle").catch(() => {});
      return;
    }
    record.idleTimer = setTimeout(tick, IDLE_TIMEOUT_MS);
    record.idleTimer.unref?.();
  };
  record.idleTimer = setTimeout(tick, IDLE_TIMEOUT_MS);
  record.idleTimer.unref?.();
}

function spawnWithPty(record, cols, rows) {
  return import("node-pty").then((imported) => {
    const nodePty = imported.default ?? imported;
    const pty = nodePty.spawn(record.shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: record.cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    record.pty = pty;
    record.pid = pty.pid;
    pty.onData((data) => {
      record.lastActive = Date.now();
      record.ring.push(data);
    });
    pty.onExit(({ exitCode }) => {
      record.closed = true;
      record.exitCode = exitCode ?? null;
      if (record.idleTimer) clearTimeout(record.idleTimer);
    });
    record.write = (data) => {
      try {
        pty.write(data);
      } catch {}
    };
    record.resize = (width, height) => {
      try {
        pty.resize(width, height);
      } catch {}
    };
    record.close = async () => {
      try {
        pty.kill();
      } catch {}
    };
  });
}

async function spawnWithSeam(ctx, record, cols, rows) {
  const handle = await ctx.subprocess.spawnTerminal({
    argv: [record.shell],
    cwd: record.cwd,
    env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
    rows,
    cols,
    graceMs: 3000,
  });
  record.handle = handle;
  record.pid = handle.pid;
  record.decoder = new StringDecoder("utf8");
  handle.output.on("data", (chunk) => {
    record.lastActive = Date.now();
    record.ring.push(record.decoder.write(chunk));
  });
  handle.output.on("end", () => {
    const tail = record.decoder.end();
    if (tail) record.ring.push(tail);
  });
  handle.done.then(
    ({ exitCode }) => {
      record.closed = true;
      record.exitCode = exitCode ?? null;
      if (record.idleTimer) clearTimeout(record.idleTimer);
    },
    () => {
      record.closed = true;
    },
  );
  record.write = (data) => handle.write(data);
  record.resize = () => {};
  record.close = async () => {
    handle.terminate();
  };
}

async function openTerminal(ctx, sessionId, cols, rows) {
  const existing = terminals.get(sessionId);
  if (existing) {
    existing.lastActive = Date.now();
    armIdle(existing);
    const snap = existing.ring.snapshot(REPLAY_MAX_UNITS);
    return {
      id: existing.id,
      cwd: existing.cwd,
      shell: existing.shell,
      pid: existing.pid,
      fresh: false,
      closed: existing.closed,
      exitCode: existing.exitCode,
      output: snap.output,
      nextOffset: snap.nextOffset,
      lossy: snap.lossy,
    };
  }
  const cwd = ctx.sessions.get(sessionId)?.header.cwd ?? process.cwd();
  const shell = defaultShell();
  const record = {
    id: `term-${++nextId}`,
    sessionId,
    cwd,
    shell,
    ring: new OutputRing(RING_MAX_UNITS),
    pid: null,
    pty: null,
    handle: null,
    decoder: null,
    closed: false,
    closing: false,
    exitCode: null,
    lastActive: Date.now(),
    idleTimer: null,
    write: () => {},
    resize: () => {},
    close: async () => {},
  };
  try {
    await spawnWithPty(record, cols, rows);
  } catch {
    await spawnWithSeam(ctx, record, cols, rows);
  }
  terminals.set(sessionId, record);
  byId.set(record.id, record);
  armIdle(record);
  return {
    id: record.id,
    cwd,
    shell,
    pid: record.pid,
    fresh: true,
    closed: false,
    exitCode: null,
    output: "",
    nextOffset: 0,
    lossy: false,
  };
}

async function closeRecord(record, reason = "closed") {
  if (record.closing) return;
  record.closing = true;
  if (record.idleTimer) clearTimeout(record.idleTimer);
  try {
    await record.close();
  } catch {}
  terminals.delete(record.sessionId);
  byId.delete(record.id);
  record.closed = true;
  record.closing = false;
}

function errorEnvelope(error) {
  return { ok: false, error: { code: "terminal_error", message: error instanceof Error ? error.message : String(error) } };
}

function createHandler(ctx) {
  return async (endpoint, payload) => {
    try {
      switch (endpoint) {
        case "open": {
          const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
          if (sessionId === "") throw new Error("A session id is required");
          const cols = clampInt(payload?.cols, MIN_COLS, MAX_COLS, DEFAULT_COLS);
          const rows = clampInt(payload?.rows, MIN_ROWS, MAX_ROWS, DEFAULT_ROWS);
          const value = await openTerminal(ctx, sessionId, cols, rows);
          return { ok: true, value };
        }
        case "write": {
          const record = byId.get(payload?.id);
          if (record === void 0 || typeof payload?.data !== "string") return { ok: true, value: {} };
          record.lastActive = Date.now();
          record.write(payload.data);
          return { ok: true, value: {} };
        }
        case "read": {
          const record = byId.get(payload?.id);
          if (record === void 0) {
            return { ok: true, value: { output: "", nextOffset: 0, lossy: false, closed: true, exitCode: null } };
          }
          record.lastActive = Date.now();
          const fromOffset = Number.isFinite(payload?.offset) ? payload.offset : record.ring.total;
          const { output, nextOffset, lossy } = record.ring.read(fromOffset);
          return { ok: true, value: { output, nextOffset, lossy, closed: record.closed, exitCode: record.exitCode } };
        }
        case "resize": {
          const record = byId.get(payload?.id);
          if (record === void 0) return { ok: true, value: {} };
          record.lastActive = Date.now();
          const cols = clampInt(payload?.cols, MIN_COLS, MAX_COLS, record.cols ?? DEFAULT_COLS);
          const rows = clampInt(payload?.rows, MIN_ROWS, MAX_ROWS, record.rows ?? DEFAULT_ROWS);
          record.cols = cols;
          record.rows = rows;
          record.resize(cols, rows);
          return { ok: true, value: {} };
        }
        case "close": {
          const record = byId.get(payload?.id);
          if (record !== void 0) await closeRecord(record, "client close");
          return { ok: true, value: {} };
        }
        default:
          throw new Error("Unknown dsh-terminal endpoint");
      }
    } catch (error) {
      return errorEnvelope(error);
    }
  };
}

const require = createRequire(import.meta.url);

const ASSETS = new Map([
  ["/xterm.js", () => require.resolve("xterm/lib/xterm.js")],
  ["/xterm.css", () => require.resolve("xterm/css/xterm.css")],
  ["/xterm-addon-fit.js", () => require.resolve("xterm-addon-fit/lib/xterm-addon-fit.js")],
]);

function contentTypeFor(path) {
  return path.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
}

async function serveAsset(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (!pathname.startsWith(`${ASSET_ROOT}/`)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const resolve = ASSETS.get(pathname.slice(ASSET_ROOT.length));
  if (resolve === void 0) {
    res.writeHead(404);
    res.end();
    return;
  }
  let file;
  try {
    file = resolve();
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": contentTypeFor(file),
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.connection.rpc.handle(CHANNEL, createHandler(ctx), { authority: "loopback" }),
    "dsh-terminal: loopback terminal RPC",
  );
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ASSET_ROOT, handler: serveAsset }),
    "dsh-terminal: xterm asset route",
  );
  ctx.effect(
    () => () => {
      for (const record of byId.values()) {
        try {
          record.close();
        } catch {}
      }
      terminals.clear();
      byId.clear();
    },
    "dsh-terminal: teardown",
  );
}

export { ASSET_ROOT, CHANNEL };
