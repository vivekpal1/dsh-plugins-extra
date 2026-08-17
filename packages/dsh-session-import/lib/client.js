window.__ModuleLoader__.load({
  id: "dsh-session-import",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const { Button, Input } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;
    const CHANNEL = "/session-import";

    function unwrap(result) {
      if (result?.ok === true) return result.value;
      throw new Error(result?.error?.message ?? "Import failed");
    }

    function ImportSection({ rpc }) {
      const [source, setSource] = React.useState("codex");
      const [sourceId, setSourceId] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [result, setResult] = React.useState();
      const [error, setError] = React.useState();
      const submit = (event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        setResult(undefined);
        rpc.call(CHANNEL, "import", { source, sourceId })
          .then(unwrap)
          .then(setResult)
          .catch((cause) => setError(cause.message))
          .finally(() => setBusy(false));
      };
      return h("section", { className: "sessionImportPage" },
        h("h2", null, "Import conversations"),
        h("p", { className: "sessionImportIntro" }, "Bring a local Codex or Claude Code conversation into DSH as resumable context. Hidden prompts, reasoning, and raw tool payloads are excluded."),
        h("form", { onSubmit: submit, className: "sessionImportCard" },
          h("label", null, "Source",
            h("select", { value: source, onChange: (event) => setSource(event.currentTarget.value) },
              h("option", { value: "codex" }, "Codex"),
              h("option", { value: "claude" }, "Claude Code"))),
          h("label", null, "Session ID",
            h(Input, { value: sourceId, onChange: (event) => setSourceId(event.currentTarget.value), placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", spellCheck: false, autoComplete: "off" })),
          h(Button, { type: "submit", variant: "primary", disabled: busy || !sourceId.trim() }, busy ? "Importing…" : "Import session"),
          error ? h("p", { className: "sessionImportError", role: "alert" }, error) : null,
          result ? h("div", { className: "sessionImportSuccess", role: "status" },
            h("strong", null, result.duplicate ? "Already imported" : "Imported"),
            h("span", null, result.title),
            h("code", null, result.sessionId),
            h("button", { type: "button", onClick: () => window.location.reload() }, "Refresh conversations")) : null));
    }

    function installSettingsNavIcon(ctx) {
      const marker = "session-import";
      const originals = new Map();
      const render = () => {
        for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
          const label = [...button.children].find((child) => child.tagName === "SPAN");
          if (label?.textContent?.trim() !== "Import") continue;
          if (button.dataset.dshPluginIcon && button.dataset.dshPluginIcon !== marker) continue;
          const current = button.querySelector("svg");
          if (!current || current.dataset.dshPluginIcon === marker) continue;
          if (!originals.has(button)) originals.set(button, current.cloneNode(true));
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          for (const attribute of ["class", "width", "height", "style"]) {
            const value = current.getAttribute(attribute);
            if (value !== null) icon.setAttribute(attribute, value);
          }
          icon.setAttribute("viewBox", "0 0 24 24");
          icon.setAttribute("fill", "none");
          icon.setAttribute("stroke", "currentColor");
          icon.setAttribute("stroke-width", "1.8");
          icon.setAttribute("stroke-linecap", "round");
          icon.setAttribute("stroke-linejoin", "round");
          icon.setAttribute("aria-hidden", "true");
          icon.setAttribute("focusable", "false");
          icon.dataset.dshPluginIcon = marker;
          icon.innerHTML = '<path d="M12 3v11M8 10l4 4 4-4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>';
          current.replaceWith(icon);
          button.dataset.dshPluginIcon = marker;
        }
      };
      const observer = new MutationObserver(render);
      ctx.effect(() => {
        render();
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        return () => {
          observer.disconnect();
          for (const [button, original] of originals) {
            if (button.dataset.dshPluginIcon !== marker) continue;
            button.querySelector(`svg[data-dsh-plugin-icon="${marker}"]`)?.replaceWith(original);
            delete button.dataset.dshPluginIcon;
          }
        };
      }, "session-import: settings icon");
    }

    const inject = ["slots", "connection"];
    function apply(ctx) {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-session-import";
      style.textContent = ".sessionImportPage{max-width:720px}.sessionImportIntro{color:var(--muted-foreground);line-height:1.55}.sessionImportCard{display:grid;gap:16px;padding:20px;border:1px solid var(--border);border-radius:14px;background:var(--card)}.sessionImportCard label{display:grid;gap:7px;font-weight:600}.sessionImportCard select{height:40px;border:1px solid var(--border);border-radius:8px;padding:0 10px;background:var(--background);color:inherit}.sessionImportError{color:#dc2626}.sessionImportSuccess{display:grid;gap:6px;padding:13px;border-radius:10px;background:color-mix(in srgb,#16a34a 12%,transparent)}.sessionImportSuccess code{font-size:12px}.sessionImportSuccess button{width:max-content;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;padding:0}";
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "session-import: style");
      installSettingsNavIcon(ctx);
      const connection = ctx.get("connection");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "session-import",
        order: 20,
        label: () => "Import",
        inject: () => ({ rpc: connection.rpc }),
      }, ImportSection));
    }
    module.exports.apply = apply;
    module.exports.inject = inject;
    return module.exports;
  },
});
