import { readFile } from "node:fs/promises";
import {
  applyOps,
  compactInventory,
  emptyScene,
  replaceElements,
  resolveInsideCwd,
  sceneFromDocument,
  writeDocument,
} from "./scene.js";

export class CanvasStore {
  constructor({ persist = true } = {}) {
    this.persist = persist;
    this.records = new Map();
  }

  record(sessionId, cwd) {
    if (typeof sessionId !== "string" || sessionId.trim() === "") throw new Error("A session id is required");
    let rec = this.records.get(sessionId);
    if (!rec) {
      rec = { sessionId, cwd: cwd ?? process.cwd(), scene: emptyScene(), loaded: false };
      this.records.set(sessionId, rec);
    } else if (cwd) rec.cwd = cwd;
    return rec;
  }

  async ensure(sessionId, cwd) {
    const rec = this.record(sessionId, cwd);
    if (rec.loaded) return rec;
    rec.loaded = true;
    if (!this.persist) return rec;
    try {
      const path = resolveInsideCwd(rec.cwd);
      const document = JSON.parse(await readFile(path, "utf8"));
      rec.scene = sceneFromDocument(document);
    } catch {
      // Missing or unreadable canvas files start empty.
    }
    return rec;
  }

  async persistRecord(rec) {
    if (!this.persist) return;
    try {
      await writeDocument(rec.cwd, undefined, rec.scene);
    } catch {
      // Autosave is best-effort; export still throws.
    }
  }

  snapshot(rec) {
    return {
      version: rec.scene.version,
      elements: rec.scene.elements,
      inventory: compactInventory(rec.scene),
      cwd: rec.cwd,
    };
  }

  async open(sessionId, cwd) {
    const rec = await this.ensure(sessionId, cwd);
    return this.snapshot(rec);
  }

  async apply(sessionId, ops, { cwd, replace } = {}) {
    const rec = await this.ensure(sessionId, cwd);
    const result = applyOps(rec.scene, ops, { replace });
    rec.scene = result.scene;
    await this.persistRecord(rec);
    return {
      applied: result.applied,
      ids: result.ids,
      version: rec.scene.version,
      elements: compactInventory(rec.scene),
    };
  }

  async write(sessionId, elements, expectedVersion, cwd) {
    const rec = await this.ensure(sessionId, cwd);
    if (Number.isFinite(expectedVersion) && expectedVersion !== rec.scene.version) {
      return { ok: false, conflict: true, ...this.snapshot(rec) };
    }
    rec.scene = replaceElements(rec.scene, Array.isArray(elements) ? elements : []);
    await this.persistRecord(rec);
    return { ok: true, conflict: false, ...this.snapshot(rec) };
  }

  async exportTo(sessionId, path, cwd) {
    const rec = await this.ensure(sessionId, cwd);
    const saved = await writeDocument(rec.cwd, path, rec.scene);
    return { path: saved, version: rec.scene.version, elements: compactInventory(rec.scene) };
  }

  dispose() {
    this.records.clear();
  }
}
