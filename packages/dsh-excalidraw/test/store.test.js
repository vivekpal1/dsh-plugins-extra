import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createExcalidrawRpcHandler } from "../lib/rpc.js";
import { CanvasStore } from "../lib/store.js";

test("store apply returns a compact inventory and persists the document", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dsh-excalidraw-store-"));
  const store = new CanvasStore();
  const result = await store.apply("session-1", [
    { op: "upsert", id: "api", type: "rectangle", label: "API" },
    { op: "upsert", id: "db", type: "rectangle", label: "DB" },
    { op: "connect", from: "api", to: "db", label: "sql" },
  ], { cwd });
  assert.equal(result.applied, 3);
  assert.equal(result.elements.length, 3);
  assert.equal(result.elements[0].id, "api");
  const saved = JSON.parse(await readFile(join(cwd, ".dsh/excalidraw/canvas.excalidraw"), "utf8"));
  assert.equal(saved.type, "excalidraw");
  assert.ok(saved.elements.some((el) => el.id === "api"));
});

test("store write rejects stale versions then accepts the next write", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dsh-excalidraw-write-"));
  const store = new CanvasStore({ persist: false });
  const first = await store.apply("s", [{ op: "upsert", id: "a", type: "rectangle", label: "A" }], { cwd });
  const stale = await store.write("s", [], first.version - 1, cwd);
  assert.equal(stale.conflict, true);
  assert.equal(stale.inventory[0].id, "a");
  const next = await store.write("s", [{ id: "a", type: "rectangle", x: 50, y: 50, width: 100, height: 80, isDeleted: false }], first.version, cwd);
  assert.equal(next.ok, true);
  assert.equal(next.inventory[0].x, 50);
});

test("RPC open and apply stay loopback-shaped and validate session id", async () => {
  const store = new CanvasStore({ persist: false });
  const handler = createExcalidrawRpcHandler({ store, cwdFor: () => process.cwd() });
  const missing = await handler("open", {});
  assert.equal(missing.ok, false);
  const opened = await handler("open", { sessionId: "sess" });
  assert.equal(opened.ok, true);
  assert.equal(opened.value.version, 0);
  const applied = await handler("apply", {
    sessionId: "sess",
    ops: [{ op: "upsert", id: "box", type: "ellipse", label: "Box" }],
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.value.ids[0], "box");
});
