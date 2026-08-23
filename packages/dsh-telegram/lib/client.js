window.__ModuleLoader__.load({
  id: "dsh-telegram",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const { Button, Input } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;
    const CHANNEL = "/dsh-telegram";

    function unwrap(result) {
      if (result?.ok === true) return result.value;
      throw new Error(result?.error?.message ?? "Telegram request failed");
    }

    function Field({ label, hint, children }) {
      return h("label", { className: "telegramField" },
        h("span", null, label),
        children,
        hint ? h("small", null, hint) : null);
    }

    function StatusBadge({ status }) {
      const state = status.running ? "online" : status.enabled ? "error" : "off";
      const label = status.running ? "Connected" : status.enabled ? "Needs attention" : "Disabled";
      return h("span", { className: `telegramBadge telegramBadge--${state}` }, h("i"), label);
    }

    function TelegramSection({ rpc }) {
      const [status, setStatus] = React.useState();
      const [token, setToken] = React.useState("");
      const [pairing, setPairing] = React.useState();
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState();
      const [notice, setNotice] = React.useState();
      const [options, setOptions] = React.useState({ defaultCwd: "", agentPreset: "", allowExistingSessions: false, allowSteer: false });

      const load = React.useCallback(async () => {
        const next = await rpc.call(CHANNEL, "status", {}).then(unwrap);
        setStatus(next);
        setOptions(next.options);
        return next;
      }, [rpc]);

      React.useEffect(() => { void load().catch((cause) => setError(cause.message)); }, [load]);
      React.useEffect(() => {
        if (!status?.enabled) return undefined;
        const timer = setInterval(() => {
          void rpc.call(CHANNEL, "status", {}).then(unwrap).then(setStatus).catch(() => {});
        }, 5000);
        return () => clearInterval(timer);
      }, [rpc, status?.enabled]);

      const run = async (operation, success) => {
        setBusy(true);
        setError(undefined);
        setNotice(undefined);
        try {
          const next = await operation();
          if (next?.options) {
            setStatus(next);
            setOptions(next.options);
          }
          if (success) setNotice(success);
          return next;
        } catch (cause) {
          setError(cause.message);
        } finally {
          setBusy(false);
        }
      };

      const saveToken = (event) => {
        event.preventDefault();
        if (!token.trim()) return setError("Enter the bot token from @BotFather");
        void run(async () => {
          const next = await rpc.call(CHANNEL, "configure-token", { token }).then(unwrap);
          setToken("");
          return next;
        }, "Bot token verified and stored in DSH credentials.");
      };

      const toggleEnabled = () => void run(
        () => rpc.call(CHANNEL, "set-enabled", { enabled: !status.enabled }).then(unwrap),
        status.enabled ? "Telegram remote control disabled." : "Telegram remote control enabled.",
      );

      const generatePairing = () => void run(async () => {
        const value = await rpc.call(CHANNEL, "generate-pairing-code", {}).then(unwrap);
        setPairing(value);
        return status;
      });

      const saveOptions = (event) => {
        event.preventDefault();
        if (options.allowExistingSessions && !window.confirm("Full-session access lets paired Telegram users read and send prompts to existing root sessions. Continue?")) return;
        void run(() => rpc.call(CHANNEL, "update-options", options).then(unwrap), "Telegram access policy saved.");
      };

      const removeToken = () => {
        if (!window.confirm("Remove the Telegram bot token and stop remote access?")) return;
        void run(() => rpc.call(CHANNEL, "remove-token", {}).then(unwrap), "Bot token removed.");
      };

      if (!status) return h("section", { className: "telegramPage" },
        h("h2", null, "Telegram"),
        error ? h("p", { className: "telegramError", role: "alert" }, error) : h("p", null, "Loading Telegram integration…"),
        error ? h(Button, { type: "button", variant: "outline", onClick: () => void load().catch((cause) => setError(cause.message)) }, "Try again") : null);

      return h("section", { className: "telegramPage" },
        h("header", { className: "telegramHeader" },
          h("div", null,
            h("h2", null, "Telegram remote control"),
            h("p", null, "Securely send prompts to DSH and receive final responses from a paired private Telegram chat.")),
          h(StatusBadge, { status })),
        error ? h("p", { className: "telegramError", role: "alert" }, error) : null,
        notice ? h("p", { className: "telegramNotice", role: "status" }, notice) : null,

        h("section", { className: "telegramCard" },
          h("div", { className: "telegramCardHead" },
            h("div", null, h("h3", null, "1. Connect a bot"), h("p", null, "Create a bot with @BotFather. Its token is stored by the DSH credentials service and is never shown again.")),
            status.bot?.username ? h("a", { href: `https://t.me/${status.bot.username}`, target: "_blank", rel: "noreferrer" }, `@${status.bot.username}`) : null),
          status.tokenConfigured
            ? h("div", { className: "telegramActions" },
                h("span", { className: "telegramMeta" }, `Token configured${status.tokenSource ? ` via ${status.tokenSource}` : ""}`),
                h(Button, { type: "button", variant: "outline", disabled: busy, onClick: removeToken }, "Remove token"))
            : h("form", { className: "telegramTokenForm", onSubmit: saveToken },
                h(Field, { label: "Bot token", hint: "Paste the token once. DSH stores it outside plugin settings." },
                  h(Input, { type: "password", value: token, onChange: (event) => setToken(event.currentTarget.value), autoComplete: "off", spellCheck: false, placeholder: "123456789:AA…", required: true })),
                h(Button, { type: "submit", variant: "primary", disabled: busy || !token.trim() }, busy ? "Verifying…" : "Verify and save"))),

        h("section", { className: "telegramCard" },
          h("div", { className: "telegramCardHead" },
            h("div", null, h("h3", null, "2. Enable polling"), h("p", null, "Outbound long polling works behind NAT and does not expose a local web server.")),
            h(Button, { type: "button", variant: status.enabled ? "outline" : "primary", disabled: busy || !status.tokenConfigured, onClick: toggleEnabled }, status.enabled ? "Disable" : "Enable")),
          status.lastError ? h("div", { className: "telegramWarning" },
            h("strong", null, "Connection issue"),
            h("span", null, status.lastError),
            status.lastError.toLowerCase().includes("webhook") ? h(Button, { type: "button", variant: "outline", disabled: busy, onClick: () => void run(() => rpc.call(CHANNEL, "clear-webhook", {}).then(unwrap), "Webhook cleared; long polling restarted.") }, "Clear webhook and retry") : null) : null),

        h("section", { className: "telegramCard" },
          h("div", { className: "telegramCardHead" },
            h("div", null, h("h3", null, "3. Pair your private chat"), h("p", null, "Generate a short-lived, single-use code locally, then send /pair CODE to your bot.")),
            h(Button, { type: "button", variant: "outline", disabled: busy || !status.tokenConfigured, onClick: generatePairing }, "Generate code")),
          pairing ? h("div", { className: "telegramPairing", role: "status" },
            h("code", null, pairing.code),
            h(Button, { type: "button", variant: "outline", onClick: () => { void navigator.clipboard.writeText(`/pair ${pairing.code}`); setNotice("Pairing command copied."); } }, "Copy /pair command"),
            h("small", null, `Expires ${new Date(pairing.expiresAt).toLocaleTimeString()}. It becomes invalid after one successful pairing.`)) : null,
          status.principals.length
            ? h("div", { className: "telegramPrincipals" }, status.principals.map((principal) => h("div", { key: `${principal.userId}:${principal.chatId}` },
                h("div", null, h("strong", null, principal.label), h("small", null, `User ${principal.userId} · Chat ${principal.chatId}`)),
                h(Button, { type: "button", variant: "outline", disabled: busy, onClick: () => {
                  if (!window.confirm(`Revoke Telegram access for ${principal.label}?`)) return;
                  void run(() => rpc.call(CHANNEL, "revoke-principal", { userId: principal.userId, chatId: principal.chatId }).then(unwrap), "Telegram access revoked.");
                } }, "Revoke"))))
            : h("p", { className: "telegramEmpty" }, "No Telegram users are paired. An empty allowlist authorizes nobody.")),

        h("form", { className: "telegramCard telegramPolicy", onSubmit: saveOptions },
          h("div", null, h("h3", null, "Access policy"), h("p", null, "Remote approvals, DSH slash commands, subagent sessions, bot messages, edited messages, channels, and group chats remain blocked.")),
          h(Field, { label: "Default project directory", hint: "Optional absolute directory used only when Telegram creates a new session. Leave blank to use the DSH host directory." },
            h(Input, { value: options.defaultCwd, onChange: (event) => setOptions({ ...options, defaultCwd: event.currentTarget.value }), placeholder: "/path/to/project" })),
          h(Field, { label: "Agent preset", hint: "Optional preset ID for Telegram-created sessions. Leave blank to use the DSH default." },
            h(Input, { value: options.agentPreset, onChange: (event) => setOptions({ ...options, agentPreset: event.currentTarget.value }), placeholder: "default" })),
          h("label", { className: "telegramCheck" },
            h("input", { type: "checkbox", checked: options.allowExistingSessions, onChange: (event) => setOptions({ ...options, allowExistingSessions: event.currentTarget.checked }) }),
            h("span", null, h("strong", null, "Allow access to existing root sessions"), h("small", null, "High trust: paired users can view history and prompt any non-subagent session."))),
          h("label", { className: "telegramCheck" },
            h("input", { type: "checkbox", checked: options.allowSteer, onChange: (event) => setOptions({ ...options, allowSteer: event.currentTarget.checked }) }),
            h("span", null, h("strong", null, "Allow /steer during active turns"), h("small", null, "Disabled by default to reduce accidental interference."))),
          h("div", { className: "telegramActions" },
            h("span", { className: "telegramMeta" }, `${status.bindingCount} active chat binding${status.bindingCount === 1 ? "" : "s"} · ${status.ownedSessionCount} Telegram-created session${status.ownedSessionCount === 1 ? "" : "s"}`),
            h(Button, { type: "submit", variant: "primary", disabled: busy }, busy ? "Saving…" : "Save policy"))));
    }

    function installSettingsNavIcon(ctx) {
      const marker = "dsh-telegram";
      const originals = new Map();
      const render = () => {
        for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
          const label = [...button.children].find((child) => child.tagName === "SPAN");
          if (label?.textContent?.trim() !== "Telegram") continue;
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
          icon.dataset.dshPluginIcon = marker;
          icon.innerHTML = '<path d="m21 3-7.4 18-4.2-7.1L3 10.7 21 3Z"/><path d="m9.4 13.9 4.2 7.1.8-5.2L21 3 9.4 13.9Z"/>';
          current.replaceWith(icon);
          button.dataset.dshPluginIcon = marker;
        }
      };
      const observer = new MutationObserver(render);
      ctx.effect(() => {
        render();
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
          observer.disconnect();
          for (const [button, original] of originals) {
            if (button.dataset.dshPluginIcon !== marker) continue;
            button.querySelector(`svg[data-dsh-plugin-icon="${marker}"]`)?.replaceWith(original);
            delete button.dataset.dshPluginIcon;
          }
        };
      }, "telegram: settings icon");
    }

    const inject = ["slots", "connection"];
    function apply(ctx) {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-telegram";
      style.textContent = ".telegramPage{max-width:860px;display:grid;gap:14px}.telegramPage h2,.telegramPage h3{margin:0}.telegramPage p{color:var(--dsw-alias-label-secondary);line-height:1.5}.telegramHeader,.telegramCardHead,.telegramActions,.telegramPrincipals>div{display:flex;align-items:center;justify-content:space-between;gap:14px}.telegramHeader>div:first-child,.telegramCardHead>div:first-child{min-width:0}.telegramCard{display:grid;gap:14px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}.telegramCard p{margin:5px 0 0}.telegramCard a{color:var(--dsw-alias-brand-primary);font-weight:650}.telegramBadge{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:13px;font-weight:650;white-space:nowrap}.telegramBadge i{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.telegramBadge--online i{background:var(--dsw-alias-state-success-primary)}.telegramBadge--error i{background:var(--dsw-alias-state-warn-primary)}.telegramField{display:grid;gap:6px;font-weight:650}.telegramField small,.telegramCheck small,.telegramPairing small,.telegramPrincipals small,.telegramMeta{color:var(--dsw-alias-label-tertiary);font-weight:400}.telegramTokenForm,.telegramPolicy{display:grid;gap:14px}.telegramError,.telegramWarning{padding:11px 13px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary)!important}.telegramWarning{display:grid;gap:8px;color:var(--dsw-alias-label-primary)!important}.telegramNotice{padding:11px 13px;border:1px solid var(--dsw-alias-state-success-primary);border-radius:9px}.telegramPairing{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:14px;border:1px solid var(--dsw-alias-brand-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.telegramPairing code{font-size:24px;font-weight:750;letter-spacing:.14em}.telegramPairing small{grid-column:1/-1}.telegramPrincipals{display:grid;gap:8px}.telegramPrincipals>div{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}.telegramPrincipals>div>div{display:grid;gap:3px}.telegramCheck{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;cursor:pointer}.telegramCheck input{width:18px;height:18px;margin-top:2px}.telegramCheck span{display:grid;gap:3px}.telegramEmpty{margin:0!important}.telegramCardHead button,.telegramActions button{flex:none}@media(max-width:640px){.telegramHeader,.telegramCardHead,.telegramActions{align-items:stretch;flex-direction:column}.telegramPairing{grid-template-columns:1fr}.telegramPairing small{grid-column:auto}.telegramPairing code{font-size:20px}.telegramPrincipals>div{align-items:stretch;flex-direction:column}}";
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "telegram: styles");
      installSettingsNavIcon(ctx);
      const connection = ctx.get("connection");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "telegram",
        order: 19,
        label: () => "Telegram",
        inject: () => ({ rpc: connection.rpc }),
      }, TelegramSection));
    }

    module.exports.apply = apply;
    module.exports.inject = inject;
    return module.exports;
  },
});
