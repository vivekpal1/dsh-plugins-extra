function errorEnvelope(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code: "excalidraw_error", message } };
}

export function createExcalidrawRpcHandler({ store, cwdFor }) {
  return async (endpoint, payload) => {
    try {
      const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
      if (sessionId === "") throw new Error("A session id is required");
      const cwd = cwdFor(sessionId);
      if (endpoint === "open" || endpoint === "read") {
        const snap = await store.open(sessionId, cwd);
        return { ok: true, value: snap };
      }
      if (endpoint === "write") {
        const value = await store.write(sessionId, payload?.elements, payload?.version, cwd);
        return { ok: true, value };
      }
      if (endpoint === "apply") {
        const value = await store.apply(sessionId, payload?.ops, { cwd, replace: payload?.replace === true });
        return { ok: true, value };
      }
      throw new Error("Unknown dsh-excalidraw endpoint");
    } catch (error) {
      return errorEnvelope(error);
    }
  };
}
