import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const DEFAULT_EXPORT_PATH = ".dsh/excalidraw/canvas.excalidraw";
export const MAX_OPS = 80;
export const MAX_ELEMENTS = 400;
export const MAX_LABEL = 200;
export const BOX_W = 220;
export const BOX_H = 90;
export const GAP_X = 80;
export const GAP_Y = 70;
export const COLS = 3;

const TYPES = new Set(["rectangle", "ellipse", "diamond", "text", "arrow", "line"]);
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const CONTAINER_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

function now() {
  return Date.now();
}

function hashId(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return Math.abs(hash) || 1;
}

function cloneScene(scene) {
  return {
    version: scene.version,
    elements: scene.elements.map((el) => ({ ...el, boundElements: el.boundElements ? el.boundElements.map((item) => ({ ...item })) : null, points: el.points ? el.points.map((point) => [...point]) : undefined, startBinding: el.startBinding ? { ...el.startBinding } : null, endBinding: el.endBinding ? { ...el.endBinding } : null, groupIds: el.groupIds ? [...el.groupIds] : [] })),
  };
}

export function emptyScene() {
  return { version: 0, elements: [] };
}

function liveElements(elements) {
  return elements.filter((el) => el.isDeleted !== true);
}

function nextIndex(elements) {
  return `a${elements.length.toString(36)}`;
}

function slugId(label, used) {
  const base = String(label || "el").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 24) || "el";
  const start = ID_PATTERN.test(base) ? base : `el-${base}`.replace(/[^A-Za-z0-9_-]/gu, "") || "el";
  const seed = ID_PATTERN.test(start) ? start : "el";
  if (!used.has(seed)) return seed;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${seed}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Could not allocate an element id");
}

function requireId(id, used, create) {
  if (id === undefined || id === null || id === "") {
    if (!create) throw new Error("Element id is required");
    return slugId("el", used);
  }
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error("Element id must be a short identifier");
  return id;
}

function clipLabel(value) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (text.length <= MAX_LABEL) return text;
  return text.slice(0, MAX_LABEL);
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function styleOf(op) {
  return {
    strokeColor: typeof op.stroke === "string" && op.stroke ? op.stroke : "#1e1e1e",
    backgroundColor: typeof op.fill === "string" && op.fill ? op.fill : CONTAINER_TYPES.has(op.type) ? "#a5d8ff" : "transparent",
    fillStyle: "solid",
    strokeWidth: numberOr(op.strokeWidth, 2),
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
  };
}

function baseElement(id, type, x, y, width, height, index, extra = {}) {
  const stamp = now();
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    ...styleOf({ type, ...extra }),
    groupIds: [],
    frameId: null,
    roundness: type === "rectangle" ? { type: 3 } : null,
    seed: hashId(id),
    version: 1,
    versionNonce: hashId(`${id}:1`),
    isDeleted: false,
    boundElements: null,
    updated: stamp,
    link: null,
    locked: false,
    index,
    ...extra,
  };
}

function textElement(id, containerId, text, x, y, width, height, index, extra = {}) {
  return {
    ...baseElement(id, "text", x, y, width, height, index, extra),
    text,
    originalText: text,
    fontSize: numberOr(extra.fontSize, 20),
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
    containerId,
    autoResize: true,
    lineHeight: 1.25,
    backgroundColor: "transparent",
    strokeWidth: 1,
  };
}

function gridSlot(count) {
  const col = count % COLS;
  const row = Math.floor(count / COLS);
  return { x: col * (BOX_W + GAP_X), y: row * (BOX_H + GAP_Y) };
}

function occupiedSlots(elements) {
  return liveElements(elements).filter((el) => CONTAINER_TYPES.has(el.type) || el.type === "text").length;
}

function findLive(elements, id) {
  return liveElements(elements).find((el) => el.id === id);
}

function centerOf(el) {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

function edgeToward(from, to) {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return { x: from.x + from.width, y: from.y + from.height / 2 };
  const hw = from.width / 2;
  const hh = from.height / 2;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(sx, sy);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function arrowGeometry(from, to) {
  const start = edgeToward(from, to);
  const end = edgeToward(to, from);
  return {
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    points: [[0, 0], [end.x - start.x, end.y - start.y]],
  };
}

function markDeleted(elements, id) {
  return elements.map((el) => {
    if (el.id === id || el.containerId === id) return { ...el, isDeleted: true, updated: now() };
    if (el.type === "arrow" && (el.startBinding?.elementId === id || el.endBinding?.elementId === id)) {
      return { ...el, isDeleted: true, updated: now() };
    }
    if (Array.isArray(el.boundElements) && el.boundElements.some((item) => item.id === id)) {
      return { ...el, boundElements: el.boundElements.filter((item) => item.id !== id), updated: now() };
    }
    return el;
  });
}

function attachBinding(elements, hostId, childId, type) {
  return elements.map((el) => {
    if (el.id !== hostId) return el;
    const current = Array.isArray(el.boundElements) ? el.boundElements.filter((item) => item.id !== childId) : [];
    current.push({ id: childId, type });
    return { ...el, boundElements: current, updated: now() };
  });
}

function upsertContainer(elements, op, used) {
  const id = requireId(op.id, used, true);
  const type = op.type;
  if (!CONTAINER_TYPES.has(type) && type !== "text") throw new Error(`Unsupported element type '${type}'`);
  const existing = findLive(elements, id);
  const placed = occupiedSlots(elements.filter((el) => el.id !== id));
  const slot = gridSlot(placed);
  const width = numberOr(op.w ?? op.width, existing?.width ?? (type === "text" ? BOX_W : BOX_W));
  const height = numberOr(op.h ?? op.height, existing?.height ?? BOX_H);
  const x = numberOr(op.x, existing?.x ?? slot.x);
  const y = numberOr(op.y, existing?.y ?? slot.y);
  const label = clipLabel(op.label ?? op.text);
  let next = elements.filter((el) => el.id !== id && el.containerId !== id);
  if (type === "text") {
    next.push(textElement(id, null, label || clipLabel(op.text) || id, x, y, width, height, existing?.index ?? nextIndex(next), op));
    used.add(id);
    return { elements: next, id };
  }
  const box = {
    ...baseElement(id, type, x, y, width, height, existing?.index ?? nextIndex(next), op),
    boundElements: existing?.boundElements ?? null,
  };
  next.push(box);
  used.add(id);
  if (label) {
    const textId = `${id}-label`;
    next.push(textElement(textId, id, label, x, y, width, height, nextIndex(next), op.label && typeof op.label === "object" ? op.label : {}));
    next = attachBinding(next, id, textId, "text");
    used.add(textId);
  }
  return { elements: next, id };
}

function upsertLine(elements, op, used) {
  const id = requireId(op.id, used, true);
  const existing = findLive(elements, id);
  const x = numberOr(op.x, existing?.x ?? 0);
  const y = numberOr(op.y, existing?.y ?? 0);
  const width = numberOr(op.w ?? op.width, existing?.width ?? 160);
  const height = numberOr(op.h ?? op.height, existing?.height ?? 0);
  const line = {
    ...baseElement(id, op.type, x, y, width, height, existing?.index ?? nextIndex(elements), op),
    points: existing?.points ?? [[0, 0], [width, height]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: op.type === "arrow" ? "arrow" : null,
  };
  const next = elements.filter((el) => el.id !== id);
  next.push(line);
  used.add(id);
  return { elements: next, id };
}

function connect(elements, op, used) {
  const from = findLive(elements, op.from);
  const to = findLive(elements, op.to);
  if (!from || !to) throw new Error("connect requires existing from and to ids");
  const id = requireId(op.id, used, true);
  const geometry = arrowGeometry(from, to);
  const existing = findLive(elements, id);
  let next = elements.filter((el) => el.id !== id && el.containerId !== id);
  const arrow = {
    ...baseElement(id, "arrow", geometry.x, geometry.y, geometry.width, geometry.height, existing?.index ?? nextIndex(next), op),
    points: geometry.points,
    lastCommittedPoint: null,
    startBinding: { elementId: from.id, focus: 0, gap: 4, fixedPoint: null },
    endBinding: { elementId: to.id, focus: 0, gap: 4, fixedPoint: null },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
  next.push(arrow);
  used.add(id);
  next = attachBinding(next, from.id, id, "arrow");
  next = attachBinding(next, to.id, id, "arrow");
  const label = clipLabel(op.label);
  if (label) {
    const textId = `${id}-label`;
    const midX = geometry.x + geometry.width / 2 - 40;
    const midY = geometry.y + geometry.height / 2 - 12;
    next.push(textElement(textId, id, label, midX, midY, 80, 24, nextIndex(next)));
    next = attachBinding(next, id, textId, "text");
    used.add(textId);
  }
  return { elements: next, id };
}

export function rebindArrows(elements) {
  const byId = new Map(liveElements(elements).map((el) => [el.id, el]));
  return elements.map((el) => {
    if (el.isDeleted || el.type !== "arrow" || !el.startBinding?.elementId || !el.endBinding?.elementId) return el;
    const from = byId.get(el.startBinding.elementId);
    const to = byId.get(el.endBinding.elementId);
    if (!from || !to) return el;
    const geometry = arrowGeometry(from, to);
    return { ...el, ...geometry, updated: now(), version: (el.version ?? 1) + 1 };
  });
}

export function applyOps(scene, ops, options = {}) {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error("ops must be a non-empty array");
  if (ops.length > MAX_OPS) throw new Error(`Too many ops (max ${MAX_OPS})`);
  let elements = options.replace === true ? [] : cloneScene(scene).elements;
  const used = new Set(liveElements(elements).map((el) => el.id));
  const ids = [];
  let applied = 0;
  for (const raw of ops) {
    if (!raw || typeof raw !== "object") throw new Error("Each op must be an object");
    const op = raw;
    if (op.op === "clear") {
      elements = [];
      used.clear();
      applied += 1;
      continue;
    }
    if (op.op === "delete") {
      const id = requireId(op.id, used, false);
      elements = markDeleted(elements, id);
      used.delete(id);
      ids.push(id);
      applied += 1;
      continue;
    }
    if (op.op === "connect") {
      const result = connect(elements, op, used);
      elements = result.elements;
      ids.push(result.id);
      applied += 1;
      continue;
    }
    if (op.op === "upsert") {
      const type = op.type;
      if (!TYPES.has(type)) throw new Error(`Unsupported element type '${type}'`);
      const result = type === "arrow" || type === "line"
        ? (op.from && op.to ? connect(elements, { ...op, op: "connect" }, used) : upsertLine(elements, op, used))
        : upsertContainer(elements, op, used);
      elements = result.elements;
      ids.push(result.id);
      applied += 1;
      continue;
    }
    throw new Error(`Unknown op '${op.op}'`);
  }
  elements = rebindArrows(elements);
  if (liveElements(elements).length > MAX_ELEMENTS) throw new Error(`Too many elements (max ${MAX_ELEMENTS})`);
  return {
    scene: { version: (scene.version ?? 0) + 1, elements },
    ids: [...new Set(ids)],
    applied,
  };
}

export function compactInventory(scene) {
  return liveElements(scene.elements)
    .filter((el) => el.type !== "text" || !el.containerId)
    .map((el) => {
      const label = el.type === "text"
        ? el.text
        : liveElements(scene.elements).find((item) => item.containerId === el.id)?.text ?? "";
      return {
        id: el.id,
        type: el.type,
        label: label || "",
        x: Math.round(el.x),
        y: Math.round(el.y),
        w: Math.round(el.width),
        h: Math.round(el.height),
      };
    });
}

export function serializeDocument(scene) {
  return {
    type: "excalidraw",
    version: 2,
    source: "dsh-excalidraw",
    elements: liveElements(scene.elements).map((el) => {
      const copy = { ...el };
      delete copy.isDeleted;
      return copy;
    }),
    appState: {
      gridSize: null,
      viewBackgroundColor: "#ffffff",
    },
    files: {},
  };
}

export function sceneFromDocument(document) {
  if (!document || document.type !== "excalidraw" || !Array.isArray(document.elements)) {
    throw new Error("Not an Excalidraw document");
  }
  return {
    version: 1,
    elements: document.elements.map((el) => ({ ...el, isDeleted: el.isDeleted === true })),
  };
}

export function resolveInsideCwd(cwd, requested) {
  if (typeof cwd !== "string" || cwd.trim() === "") throw new Error("A workspace directory is required");
  const base = resolve(cwd);
  const target = resolve(base, typeof requested === "string" && requested.trim() !== "" ? requested : DEFAULT_EXPORT_PATH);
  const rel = relative(base, target);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error("Export path must stay inside the session workspace");
  }
  return target;
}

export async function writeDocument(cwd, requested, scene) {
  const path = resolveInsideCwd(cwd, requested);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(serializeDocument(scene), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

export function replaceElements(scene, elements) {
  return { version: (scene.version ?? 0) + 1, elements: rebindArrows(elements.map((el) => ({ ...el }))) };
}

export { join };
