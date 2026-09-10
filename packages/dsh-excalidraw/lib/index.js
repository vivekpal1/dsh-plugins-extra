/**
 * dsh-excalidraw server half.
 *
 * Owns one Excalidraw-compatible scene per conversation session. Agent tools
 * mutate it in compact batches; the web tab is a live view over loopback RPC.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createExcalidrawRpcHandler } from "./rpc.js";
import { CanvasStore } from "./store.js";
import { createExcalidrawTools } from "./tools.js";

export const name = "dsh-excalidraw";
export const inject = ["sessions", "connection", "webServer", "tools"];

export const CHANNEL = "/dsh-excalidraw";
export const ASSET_ROOT = "/dsh-excalidraw-assets";

const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets");
const ASSETS = new Map([
  ["/app.html", { file: "app.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/app.css", { file: "app.css", type: "text/css; charset=utf-8" }],
]);

function cwdFor(ctx, sessionId) {
  return ctx.sessions.get(sessionId)?.header.cwd ?? process.cwd();
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
  const asset = ASSETS.get(pathname.slice(ASSET_ROOT.length));
  if (asset === undefined) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const body = await readFile(join(ASSET_DIR, asset.file));
    res.writeHead(200, {
      "content-type": asset.type,
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

export function apply(ctx) {
  const store = new CanvasStore();
  const lookupCwd = (sessionId) => cwdFor(ctx, sessionId);
  for (const tool of createExcalidrawTools({ store, cwdFor: lookupCwd })) ctx.tools.register(tool);
  const prompt = ctx.get("systemPrompt");
  if (prompt) {
    prompt.section({
      name: "tool:excalidraw",
      order: 108,
      text: "Use excalidraw_apply to draw diagrams on the Excalidraw tab in one batch. Use excalidraw_scene to inspect ids. Do not paste mermaid or ASCII art when a canvas diagram is needed. Never request screenshots of the canvas.",
    });
  }
  ctx.effect(
    () => ctx.connection.rpc.handle(CHANNEL, createExcalidrawRpcHandler({ store, cwdFor: lookupCwd }), { authority: "loopback" }),
    "dsh-excalidraw: loopback canvas RPC",
  );
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ASSET_ROOT, handler: serveAsset }),
    "dsh-excalidraw: canvas asset route",
  );
  ctx.effect(
    () => () => store.dispose(),
    "dsh-excalidraw: teardown",
  );
}

export { ASSET_ROOT, CHANNEL, CanvasStore, createExcalidrawRpcHandler, createExcalidrawTools };
