import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyOps,
  compactInventory,
  emptyScene,
  rebindArrows,
  resolveInsideCwd,
  serializeDocument,
  writeDocument,
} from "../lib/scene.js";

test("upsert creates a labelled rectangle with a stable id", () => {
  const { scene, ids, applied } = applyOps(emptyScene(), [
    { op: "upsert", id: "auth", type: "rectangle", label: "Auth" },
  ]);
  assert.equal(applied, 1);
  assert.deepEqual(ids, ["auth"]);
  const box = scene.elements.find((el) => el.id === "auth");
  assert.equal(box.type, "rectangle");
  assert.equal(box.isDeleted, false);
  const text = scene.elements.find((el) => el.containerId === "auth");
  assert.equal(text?.text, "Auth");
  assert.equal(text?.type, "text");
});

test("connect binds an arrow between two existing ids", () => {
  const first = applyOps(emptyScene(), [
    { op: "upsert", id: "a", type: "rectangle", label: "A", x: 0, y: 0 },
    { op: "upsert", id: "b", type: "rectangle", label: "B", x: 400, y: 0 },
    { op: "connect", id: "a-b", from: "a", to: "b", label: "calls" },
  ]);
  const arrow = first.scene.elements.find((el) => el.id === "a-b");
  assert.equal(arrow.type, "arrow");
  assert.equal(arrow.startBinding.elementId, "a");
  assert.equal(arrow.endBinding.elementId, "b");
  const label = first.scene.elements.find((el) => el.containerId === "a-b");
  assert.equal(label?.text, "calls");
});

test("delete removes an element and incident arrows", () => {
  const created = applyOps(emptyScene(), [
    { op: "upsert", id: "a", type: "rectangle", label: "A" },
    { op: "upsert", id: "b", type: "rectangle", label: "B" },
    { op: "connect", from: "a", to: "b" },
  ]);
  const after = applyOps(created.scene, [{ op: "delete", id: "a" }]);
  assert.equal(after.scene.elements.some((el) => el.id === "a" && !el.isDeleted), false);
  assert.equal(after.scene.elements.filter((el) => el.type === "arrow" && !el.isDeleted).length, 0);
});

test("clear empties the scene", () => {
  const created = applyOps(emptyScene(), [{ op: "upsert", type: "ellipse", label: "X" }]);
  const cleared = applyOps(created.scene, [{ op: "clear" }]);
  assert.equal(cleared.scene.elements.filter((el) => !el.isDeleted).length, 0);
});

test("inventory is compact and omits deleted elements", () => {
  const { scene } = applyOps(emptyScene(), [
    { op: "upsert", id: "web", type: "rectangle", label: "Web", x: 10, y: 20, w: 200, h: 80 },
    { op: "upsert", id: "gone", type: "diamond", label: "Gone" },
    { op: "delete", id: "gone" },
  ]);
  const inventory = compactInventory(scene);
  assert.equal(inventory.length, 1);
  assert.deepEqual(inventory[0], { id: "web", type: "rectangle", label: "Web", x: 10, y: 20, w: 200, h: 80 });
});

test("auto-layout places items in a grid when x and y are omitted", () => {
  const { scene } = applyOps(emptyScene(), [
    { op: "upsert", id: "one", type: "rectangle", label: "One" },
    { op: "upsert", id: "two", type: "rectangle", label: "Two" },
    { op: "upsert", id: "three", type: "rectangle", label: "Three" },
    { op: "upsert", id: "four", type: "rectangle", label: "Four" },
  ]);
  const one = scene.elements.find((el) => el.id === "one");
  const two = scene.elements.find((el) => el.id === "two");
  const four = scene.elements.find((el) => el.id === "four");
  assert.equal(one.x, 0);
  assert.equal(one.y, 0);
  assert.ok(two.x > one.x);
  assert.equal(two.y, 0);
  assert.equal(four.x, 0);
  assert.ok(four.y > one.y);
});

test("rebindArrows updates stored points after a box moves", () => {
  const created = applyOps(emptyScene(), [
    { op: "upsert", id: "a", type: "rectangle", x: 0, y: 0, w: 100, h: 80 },
    { op: "upsert", id: "b", type: "rectangle", x: 400, y: 0, w: 100, h: 80 },
    { op: "connect", id: "a-b", from: "a", to: "b" },
  ]);
  const moved = created.scene.elements.map((el) => (el.id === "b" ? { ...el, x: 800 } : el));
  const rebound = rebindArrows(moved);
  const arrow = rebound.find((el) => el.id === "a-b");
  assert.ok(arrow.width > 500);
});

test("rejects unknown types, too many ops, and bad ids", () => {
  assert.throws(() => applyOps(emptyScene(), [{ op: "upsert", type: "star" }]), /type/u);
  assert.throws(() => applyOps(emptyScene(), [{ op: "upsert", id: "../x", type: "rectangle" }]), /id/u);
  assert.throws(() => applyOps(emptyScene(), Array.from({ length: 81 }, (_, i) => ({ op: "upsert", id: `n${i}`, type: "rectangle" }))), /ops/u);
});

test("export path stays inside the session workspace", () => {
  assert.equal(resolveInsideCwd("/tmp/proj", "docs/arch.excalidraw"), join("/tmp/proj", "docs/arch.excalidraw"));
  assert.equal(resolveInsideCwd("/tmp/proj"), join("/tmp/proj", ".dsh/excalidraw/canvas.excalidraw"));
  assert.throws(() => resolveInsideCwd("/tmp/proj", "../escape.excalidraw"), /workspace/u);
});

test("serializeDocument writes Excalidraw file JSON and writeDocument persists it", async () => {
  const { scene } = applyOps(emptyScene(), [{ op: "upsert", id: "box", type: "rectangle", label: "Box" }]);
  const json = serializeDocument(scene);
  assert.equal(json.type, "excalidraw");
  assert.equal(json.version, 2);
  assert.ok(json.elements.some((el) => el.id === "box"));
  const dir = await mkdtemp(join(tmpdir(), "dsh-excalidraw-"));
  const path = await writeDocument(dir, "diagram.excalidraw", scene);
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.elements.find((el) => el.id === "box").type, "rectangle");
});
