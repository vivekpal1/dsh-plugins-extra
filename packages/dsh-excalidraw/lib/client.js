window.__ModuleLoader__.load({
  id: "dsh-excalidraw",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const NS = "excalidraw";
    const CHANNEL = "/dsh-excalidraw";
    const ASSET_ROOT = "/dsh-excalidraw-assets";

    const zh = {
      "view.excalidraw": "画布",
      "bar.placeholder": "Excalidraw",
      "state.loading": "正在打开画布…",
    };
    const en = {
      "view.excalidraw": "Excalidraw",
      "bar.placeholder": "Excalidraw",
      "state.loading": "Opening canvas…",
    };

    function unwrap(result) {
      if (result && result.ok === true) return result.value;
      throw new Error(result && result.error && result.error.message ? result.error.message : "Excalidraw request failed");
    }

    function CanvasView(props) {
      const { sessionId, rpc, t } = props;
      const frameRef = useRef(null);
      const [status, setStatus] = useState({ kind: "loading", count: 0, version: 0 });

      useEffect(() => {
        const frame = frameRef.current;
        if (frame === null) return;
        let disposed = false;
        let pollTimer = null;
        let polling = false;
        let version = -1;
        let ready = false;
        const call = (endpoint, payload) => rpc.call(CHANNEL, endpoint, payload).then(unwrap);

        function pushScene(snap) {
          version = snap.version;
          const win = frame.contentWindow;
          if (win && ready) win.postMessage({ type: "scene", version: snap.version, elements: snap.elements }, "*");
          setStatus({ kind: "ready", count: snap.inventory.length, version: snap.version });
        }

        function schedule(delay) {
          if (disposed || polling) return;
          polling = true;
          pollTimer = setTimeout(() => {
            call("read", { sessionId }).then((snap) => {
              polling = false;
              if (disposed) return;
              if (snap.version !== version) pushScene(snap);
              schedule(280);
            }).catch(() => {
              polling = false;
              if (!disposed) schedule(800);
            });
          }, delay);
        }

        function onMessage(event) {
          if (event.source !== frame.contentWindow) return;
          const data = event.data;
          if (!data) return;
          if (data.type === "ready") {
            ready = true;
            call("open", { sessionId }).then((snap) => {
              if (!disposed) pushScene(snap);
            }).catch((error) => {
              if (!disposed) setStatus({ kind: "error", message: error.message });
            });
            return;
          }
          if (data.type === "change" && Array.isArray(data.elements)) {
            call("write", { sessionId, version, elements: data.elements }).then((snap) => {
              if (disposed) return;
              version = snap.version;
              setStatus({ kind: "ready", count: snap.inventory.length, version: snap.version });
            }).catch(() => {});
          }
        }

        window.addEventListener("message", onMessage);
        schedule(120);
        return () => {
          disposed = true;
          if (pollTimer !== null) clearTimeout(pollTimer);
          window.removeEventListener("message", onMessage);
        };
      }, [sessionId, rpc]);

      return h("div", { className: "dshExcalidrawRoot" },
        h("div", { className: "dshExcalidrawBar" },
          h("span", { className: "dshExcalidrawMeta" }, status.kind === "ready" ? `${status.count} elements · v${status.version}` : t("bar.placeholder")),
          status.kind === "error" ? h("span", { className: "dshExcalidrawError" }, status.message) : null,
        ),
        h("div", { className: "dshExcalidrawFrame" },
          h("iframe", {
            ref: frameRef,
            className: "dshExcalidrawIframe",
            title: "Excalidraw",
            src: `${ASSET_ROOT}/app.html`,
          }),
          status.kind === "loading" ? h("div", { className: "dshExcalidrawMessage" }, t("state.loading")) : null,
        ),
      );
    }

    const inject = ["slots", "connection", "locale"];

    function apply(ctx) {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-excalidraw";
      style.textContent = [
        ".dshExcalidrawRoot{box-sizing:border-box;height:100%;min-height:0;flex-direction:column;gap:8px;padding:0 20px 16px;display:flex}",
        ".dshExcalidrawBar{flex:none;align-items:center;gap:10px;min-width:0;color:var(--dsw-alias-label-tertiary,#71717a);font:400 12px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;display:flex}",
        ".dshExcalidrawMeta{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
        ".dshExcalidrawError{color:var(--dsw-alias-state-danger-primary,#f87171)}",
        ".dshExcalidrawFrame{box-sizing:border-box;flex:1;min-height:0;background:#fff;border:1px solid var(--dsw-alias-border-l2,#27272a);border-radius:12px;overflow:hidden;position:relative}",
        ".dshExcalidrawIframe{width:100%;height:100%;border:0;background:#fff}",
        ".dshExcalidrawMessage{position:absolute;inset:0;place-items:center;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:13px;line-height:20px;text-align:center;padding:16px;display:grid}",
      ].join("");
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "dsh-excalidraw: style");
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-excalidraw: dictionaries");
      const t = ctx.locale.bind(NS);
      const connection = ctx.get("connection");
      const rpc = connection.rpc;
      ctx.slots.inject("conversation.view", () => ctx.slots.register({
        name: "conversation.view",
        id: "excalidraw",
        order: 30,
        locale: NS,
        label: () => t("view.excalidraw"),
        inject: () => ({ rpc }),
      }, CanvasView));
    }

    module.exports.apply = apply;
    module.exports.inject = inject;
    return module.exports;
  },
});
