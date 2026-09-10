import { defineTool } from "@deepseek-ai/dsh-tools";

export const APPLY_TOOL = "excalidraw_apply";
export const SCENE_TOOL = "excalidraw_scene";
export const EXPORT_TOOL = "excalidraw_export";

const text = (value) => [{ type: "text", text: value }];
const required = (schema) => ({ ...schema, required: true });

const elementSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: required({ type: "string" }),
    type: required({ type: "string" }),
    label: required({ type: "string" }),
    x: required({ type: "number" }),
    y: required({ type: "number" }),
    w: required({ type: "number" }),
    h: required({ type: "number" }),
  },
};

function requireSession(exec) {
  const sessionId = exec.agent?.id;
  if (typeof sessionId !== "string" || sessionId === "") throw new Error("Excalidraw tools require an owning agent session");
  return sessionId;
}

function formatInventory(elements) {
  if (elements.length === 0) return "(empty canvas)";
  return elements.map((el) => `${el.id}\t${el.type}\t${el.label || "—"}\t@${el.x},${el.y} ${el.w}x${el.h}`).join("\n");
}

export function createExcalidrawTools({ store, cwdFor }) {
  const applyTool = defineTool({
    name: APPLY_TOOL,
    description: "Draw or edit the session Excalidraw canvas in one batch. Prefer this over mermaid/ASCII. Ops: upsert (rectangle|ellipse|diamond|text|arrow|line with optional id,x,y,w,h,label,fill,stroke), connect (from,to,label), delete (id), clear. Omit x/y to auto-layout.",
    parameters: {
      ops: {
        type: "array",
        required: true,
        description: "Batch of canvas operations. One apply call should draw the whole diagram.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            op: required({ type: "string", enum: ["upsert", "connect", "delete", "clear"] }),
            id: { type: "string" },
            type: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
            label: { type: "string" },
            text: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            stroke: { type: "string" },
            fill: { type: "string" },
          },
        },
      },
      replace: {
        type: "boolean",
        description: "If true, replace the whole scene before applying ops.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          applied: required({ type: "integer" }),
          version: required({ type: "integer" }),
          ids: required({ type: "array", items: { type: "string" } }),
          elements: required({ type: "array", items: elementSchema }),
        },
      },
      render: (_args, value) => text(`Applied ${value.applied} ops (v${value.version}).\n${formatInventory(value.elements)}`),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      const sessionId = requireSession(exec);
      return store.apply(sessionId, args.ops, { cwd: cwdFor(sessionId), replace: args.replace === true });
    },
  });

  const sceneTool = defineTool({
    name: SCENE_TOOL,
    description: "Read a compact inventory of the current Excalidraw canvas (id, type, label, bounds). Does not return screenshots.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          version: required({ type: "integer" }),
          elements: required({ type: "array", items: elementSchema }),
        },
      },
      render: (_args, value) => text(`Canvas v${value.version}\n${formatInventory(value.elements)}`),
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      exec.signal.throwIfAborted();
      const sessionId = requireSession(exec);
      const snap = await store.open(sessionId, cwdFor(sessionId));
      return { version: snap.version, elements: snap.inventory };
    },
  });

  const exportTool = defineTool({
    name: EXPORT_TOOL,
    description: "Write the current canvas as an .excalidraw file inside the session workspace. Default: .dsh/excalidraw/canvas.excalidraw",
    parameters: {
      path: {
        type: "string",
        description: "Workspace-relative destination. Must stay inside the session project directory.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: required({ type: "string" }),
          version: required({ type: "integer" }),
          elements: required({ type: "array", items: elementSchema }),
        },
      },
      render: (_args, value) => text(`Exported canvas v${value.version} to ${value.path}`),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      const sessionId = requireSession(exec);
      return store.exportTo(sessionId, args.path, cwdFor(sessionId));
    },
  });

  return [applyTool, sceneTool, exportTool];
}
