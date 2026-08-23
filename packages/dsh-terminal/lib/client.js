window.__ModuleLoader__.load({
  id: "dsh-terminal",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const NS = "terminal";
    const CHANNEL = "/dsh-terminal";
    const ASSET_ROOT = "/dsh-terminal-assets";

    const zh = {
      "view.terminal": "终端",
      "bar.placeholder": "终端",
      "bar.exited": "已退出",
      "bar.close": "关闭终端",
      "bar.new": "新建终端",
      "state.loading": "正在启动终端…",
    };
    const en = {
      "view.terminal": "Terminal",
      "bar.placeholder": "Terminal",
      "bar.exited": "exited",
      "bar.close": "Close terminal",
      "bar.new": "New terminal",
      "state.loading": "Starting terminal…",
    };

    function unwrap(result) {
      if (result && result.ok === true) return result.value;
      throw new Error(result && result.error && result.error.message ? result.error.message : "Terminal request failed");
    }

    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => {
          script.remove();
          resolve();
        };
        script.onerror = () => {
          script.remove();
          reject(new Error(`Failed to load ${src}`));
        };
        document.head.append(script);
      });
    }

    function loadCss(src) {
      return new Promise((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = src;
        link.onload = () => resolve();
        link.onerror = () => resolve();
        document.head.append(link);
      });
    }

    let assetsPromise = null;
    function ensureAssets() {
      if (assetsPromise === null) {
        assetsPromise = Promise.all([
          loadScript(`${ASSET_ROOT}/xterm.js`),
          loadScript(`${ASSET_ROOT}/xterm-addon-fit.js`),
          loadCss(`${ASSET_ROOT}/xterm.css`),
        ]);
      }
      return assetsPromise;
    }

    const TERMINAL_THEME = {
      background: "#0b0d10",
      foreground: "#d4d4d8",
      cursor: "#a78bfa",
      cursorAccent: "#0b0d10",
      selectionBackground: "#3f3f4688",
      black: "#18181b",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e4e4e7",
      brightBlack: "#52525b",
      brightRed: "#fca5a5",
      brightGreen: "#86efac",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#fafafa",
    };

    function TerminalView(props) {
      const { sessionId, rpc, t } = props;
      const shellRef = useRef(null);
      const [assets, setAssets] = useState({ ready: false, error: null });
      const [status, setStatus] = useState({ kind: "connecting" });
      const [run, setRun] = useState(0);

      useEffect(() => {
        let alive = true;
        ensureAssets().then(
          () => {
            if (alive) setAssets({ ready: true, error: null });
          },
          (error) => {
            if (alive) setAssets({ ready: false, error: error.message });
          },
        );
        return () => {
          alive = false;
        };
      }, []);

      useEffect(() => {
        if (!assets.ready) return;
        const container = shellRef.current;
        if (container === null) return;
        const Terminal = window.Terminal;
        const FitAddonCtor = window.FitAddon && window.FitAddon.FitAddon;
        if (typeof Terminal !== "function") {
          setStatus({ kind: "error", message: "Terminal engine is unavailable" });
          return;
        }
        let disposed = false;
        let closed = false;
        let remoteId = null;
        let pollTimer = null;
        let polling = false;
        let lastOffset = 0;
        let term;
        let fit = null;
        const call = (endpoint, payload) => rpc.call(CHANNEL, endpoint, payload).then(unwrap);

        term = new Terminal({
          fontFamily: "SFMono-Regular, ui-monospace, Menlo, Consolas, monospace",
          fontSize: 13,
          lineHeight: 1.25,
          cursorBlink: true,
          scrollback: 5000,
          theme: TERMINAL_THEME,
        });
        if (FitAddonCtor !== void 0) {
          fit = new FitAddonCtor();
          term.loadAddon(fit);
        }
        term.open(container);
        try {
          if (fit !== null) fit.fit();
        } catch {}
        term.focus();

        const resizeObserver = new ResizeObserver(() => {
          try {
            if (fit !== null) fit.fit();
          } catch {}
          if (remoteId !== null) call("resize", { id: remoteId, cols: term.cols, rows: term.rows }).catch(() => {});
        });
        resizeObserver.observe(container);

        const dataDisposable = term.onData((data) => {
          if (remoteId !== null && !closed) call("write", { id: remoteId, data }).catch(() => {});
        });

        function schedulePoll(delay) {
          if (disposed || closed || polling || remoteId === null) return;
          polling = true;
          pollTimer = setTimeout(() => {
            call("read", { id: remoteId, offset: lastOffset }).then((result) => {
              polling = false;
              if (disposed || closed) return;
              lastOffset = result.nextOffset;
              if (result.output) term.write(result.output);
              if (result.closed) {
                closed = true;
                setStatus((s) => ({ ...s, kind: "closed", exitCode: result.exitCode }));
                return;
              }
              schedulePoll(120);
            }).catch(() => {
              polling = false;
              if (!disposed && !closed) schedulePoll(500);
            });
          }, delay);
        }

        call("open", { sessionId, cols: term.cols, rows: term.rows }).then((info) => {
          if (disposed) {
            call("close", { id: info.id }).catch(() => {});
            return;
          }
          remoteId = info.id;
          lastOffset = info.nextOffset;
          setStatus({ kind: "ready", cwd: info.cwd, shell: info.shell, pid: info.pid });
          if (info.output) term.write(info.output);
          if (info.closed) {
            closed = true;
            setStatus((s) => ({ ...s, kind: "closed", exitCode: info.exitCode }));
            return;
          }
          schedulePoll(80);
        }).catch((error) => {
          if (!disposed) {
            setStatus({ kind: "error", message: error.message });
            try {
              term.write(`\r\n\x1b[31m${error.message}\x1b[0m\r\n`);
            } catch {}
          }
        });

        return () => {
          disposed = true;
          if (pollTimer !== null) clearTimeout(pollTimer);
          resizeObserver.disconnect();
          dataDisposable.dispose();
          if (remoteId !== null) call("close", { id: remoteId }).catch(() => {});
          try {
            term.dispose();
          } catch {}
        };
      }, [assets.ready, sessionId, rpc, run]);

      const bar = [];
      bar.push(h("span", {
        key: "cwd",
        className: "dshTerminalCwd",
        title: status.kind === "ready" ? status.cwd : "",
      }, status.kind === "ready" ? status.cwd : t("bar.placeholder")));
      if (status.kind === "ready") bar.push(h("span", { key: "pid", className: "dshTerminalPid" }, `pid ${status.pid}`));
      if (status.kind === "closed") bar.push(h("span", { key: "exit", className: "dshTerminalExit" }, t("bar.exited")));
      if (status.kind === "ready" || status.kind === "closed") {
        bar.push(h("button", {
          key: "close",
          type: "button",
          className: "dshTerminalClose",
          onClick: () => setRun((value) => value + 1),
        }, status.kind === "closed" ? t("bar.new") : t("bar.close")));
      }

      return h("div", { className: "dshTerminalRoot" },
        h("div", { className: "dshTerminalBar" }, bar),
        h("div", { className: "dshTerminalFrame" },
          h("div", { className: "dshTerminalShell", ref: shellRef }),
          assets.error !== null
            ? h("div", { className: "dshTerminalMessage" }, assets.error)
            : !assets.ready
              ? h("div", { className: "dshTerminalMessage" }, t("state.loading"))
              : status.kind === "error"
                ? h("div", { className: "dshTerminalMessage" }, status.message)
                : null));
    }

    const inject = ["slots", "connection", "locale"];

    function apply(ctx) {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-terminal";
      style.textContent = [
        ".dshTerminalRoot{box-sizing:border-box;height:100%;min-height:0;flex-direction:column;gap:8px;padding:0 20px 16px;display:flex}",
        ".dshTerminalBar{flex:none;align-items:center;gap:10px;min-width:0;color:var(--dsw-alias-label-tertiary,#71717a);font:400 12px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;display:flex}",
        ".dshTerminalCwd{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
        ".dshTerminalPid{flex:none}",
        ".dshTerminalExit{flex:none;color:var(--dsw-alias-state-warn-primary,#facc15)}",
        ".dshTerminalClose{margin-left:auto;flex:none;color:var(--dsw-alias-label-secondary,#a1a1aa);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2,#27272a);border-radius:8px;padding:2px 10px;font:inherit}",
        ".dshTerminalClose:hover{background:var(--dsw-alias-interactive-bg-hover,#27272a33)}",
        ".dshTerminalFrame{box-sizing:border-box;flex:1;min-height:0;background:#0b0d10;border:1px solid var(--dsw-alias-border-l2,#27272a);border-radius:12px;padding:8px;display:flex}",
        ".dshTerminalShell{flex:1;min-height:0;position:relative;overflow:hidden}",
        ".dshTerminalShell .xterm{height:100%}",
        ".dshTerminalMessage{position:absolute;inset:0;place-items:center;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:13px;line-height:20px;text-align:center;padding:16px;display:grid}",
      ].join("");
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "dsh-terminal: style");
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-terminal: dictionaries");
      const t = ctx.locale.bind(NS);
      const connection = ctx.get("connection");
      const rpc = connection.rpc;
      ensureAssets().catch(() => {});
      ctx.slots.inject("conversation.view", () => ctx.slots.register({
        name: "conversation.view",
        id: "terminal",
        order: 20,
        locale: NS,
        label: () => t("view.terminal"),
        inject: () => ({ rpc }),
      }, TerminalView));
    }

    module.exports.apply = apply;
    module.exports.inject = inject;
    return module.exports;
  },
});
