window.__ModuleLoader__.load({
  id: "dsh-themes",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const { Button } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;
    const CHANNEL = "/community-themes";
    const palettes = [
      { id: "catppuccin-mocha", label: "Catppuccin Mocha", colors: ["#1e1e2e", "#181825", "#313244", "#45475a", "#cdd6f4", "#bac2de", "#6c7086", "#cba6f7", "#b4befe", "#89b4fa", "#f38ba8", "#a6e3a1", "#f9e2af"] },
      { id: "gruvbox-dark", label: "Gruvbox Dark", colors: ["#282828", "#1d2021", "#3c3836", "#504945", "#ebdbb2", "#d5c4a1", "#a89984", "#fe8019", "#fabd2f", "#83a598", "#fb4934", "#b8bb26", "#fabd2f"] },
      { id: "nord", label: "Nord", colors: ["#2e3440", "#242933", "#3b4252", "#434c5e", "#eceff4", "#d8dee9", "#7b88a1", "#88c0d0", "#8fbcbb", "#81a1c1", "#bf616a", "#a3be8c", "#ebcb8b"] },
      { id: "tokyo-night", label: "Tokyo Night", colors: ["#1a1b26", "#16161e", "#24283b", "#414868", "#c0caf5", "#a9b1d6", "#737aa2", "#7aa2f7", "#bb9af7", "#7dcfff", "#f7768e", "#9ece6a", "#e0af68"] },
      { id: "dracula", label: "Dracula", colors: ["#282a36", "#21222c", "#343746", "#44475a", "#f8f8f2", "#d7d7d2", "#6272a4", "#bd93f9", "#ff79c6", "#8be9fd", "#ff5555", "#50fa7b", "#f1fa8c"] },
    ].map((item) => ({ ...item, preview: [item.colors[0], item.colors[2], item.colors[7], item.colors[4]] }));
    const tokenMap = (colors) => {
      const [base, mantle, surface, overlay, text, subtext, muted, accent, accentHover, blue, red, green, yellow] = colors;
      return {
        "--dsw-alias-bg-base": base, "--dsw-alias-bg-layer-1": mantle, "--dsw-alias-bg-layer-2": surface,
        "--dsw-alias-bg-layer-3": overlay, "--dsw-alias-bg-overlay": mantle, "--dsw-alias-bg-primary": surface,
        "--dsw-alias-bg-module-platform": mantle, "--dsw-alias-border-l1": surface, "--dsw-alias-border-l2": overlay,
        "--dsw-alias-border-l3": muted, "--dsw-alias-brand-primary": accent, "--dsw-alias-brand-primary-invert": base,
        "--dsw-alias-brand-text": accent, "--dsw-alias-button-primary-fill": accent, "--dsw-alias-button-primary-hover": accentHover,
        "--dsw-alias-button-primary-dimmed": overlay, "--dsw-alias-button-ghost-active-fill": surface,
        "--dsw-alias-button-ghost-active-hover": overlay, "--dsw-alias-button-floating-fill": surface,
        "--dsw-alias-button-floating-hover": overlay, "--dsw-alias-button-tool-bar-fill": surface,
        "--dsw-alias-button-tool-bar-hover": overlay, "--dsw-alias-interactive-bg-primary": surface,
        "--dsw-alias-interactive-bg-active": overlay, "--dsw-alias-interactive-bg-hover": surface,
        "--dsw-alias-label-primary": text, "--dsw-alias-label-primary-foreground": base,
        "--dsw-alias-label-primary-inverted": base, "--dsw-alias-label-secondary": subtext,
        "--dsw-alias-label-tertiary": muted, "--dsw-alias-label-quaternary": muted,
        "--dsw-alias-label-caption": subtext, "--dsw-alias-label-dimmed": muted,
        "--dsw-alias-label-error": red, "--dsw-alias-label-primary-bluish": blue,
        "--dsw-alias-line-secondary": overlay, "--dsw-alias-separator-primary": surface,
        "--dsw-alias-markdown-code-block": mantle, "--dsw-alias-markdown-code-block-banner": surface,
        "--dsw-alias-markdown-inline-code": surface, "--dsw-alias-markdown-citation": accent,
        "--dsw-alias-markdown-tag": blue, "--dsw-alias-scrollbar-bg-l1": overlay,
        "--dsw-alias-scrollbar-bg-l2": muted, "--dsw-alias-scrollbar-hover-l1": muted,
        "--dsw-alias-scrollbar-hover-l2": subtext, "--dsw-alias-state-error-primary": red,
        "--dsw-alias-state-success-primary": green, "--dsw-alias-state-warn-primary": yellow,
        "--dsw-alias-toast-bg": surface, "--dsw-alias-tooltip-bg": mantle,
      };
    };

    function unwrap(result) {
      if (result?.ok === true) return result.value;
      throw new Error(result?.error?.message ?? "Theme request failed");
    }

    function ThemeSection({ rpc, theme, subscribeTheme }) {
      const [selected, setSelected] = React.useState(theme.getTheme().preference);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState();
      React.useEffect(() => {
        const dispose = subscribeTheme((snapshot) => setSelected(snapshot.preference));
        return typeof dispose === "function" ? dispose : undefined;
      }, [theme]);
      const choose = (id) => {
        setBusy(true);
        setError(undefined);
        try {
          theme.setTheme(id);
          setSelected(id);
        } catch (cause) {
          setError(cause.message);
          setBusy(false);
          return;
        }
        rpc.call(CHANNEL, "set", { preference: id }).then(unwrap).catch((cause) => setError(cause.message)).finally(() => setBusy(false));
      };
      const option = (item) => h("button", {
        type: "button",
        className: "communityThemeOption",
        "data-selected": selected === item.id,
        onClick: () => choose(item.id),
        disabled: busy,
      },
      h("span", { className: "communityThemeSwatches" }, item.preview.map((color) => h("i", { key: color, style: { background: color } }))),
      h("span", null, item.label),
      selected === item.id ? h("strong", null, "Active") : null);
      return h("section", { className: "communityThemesPage" },
        h("h2", null, "Community themes"),
        h("p", null, "Comfortable dark palettes built on DSH's native semantic theme tokens."),
        h("div", { className: "communityThemeGrid" }, palettes.map(option)),
        h(Button, { type: "button", variant: "outline", disabled: busy, onClick: () => choose("system") }, "Use DSH system theme"),
        error ? h("p", { className: "communityThemeError", role: "alert" }, error) : null);
    }

    function installSettingsNavIcon(ctx) {
      const marker = "community-themes";
      const originals = new Map();
      const render = () => {
        for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
          const label = [...button.children].find((child) => child.tagName === "SPAN");
          if (label?.textContent?.trim() !== "Themes") continue;
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
          icon.innerHTML = '<path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 0-3.6h-.7a1.7 1.7 0 0 1 0-3.4H15a6 6 0 0 0 0-12h-3Z"/><circle cx="7.5" cy="10" r=".8" fill="currentColor" stroke="none"/><circle cx="9" cy="6.7" r=".8" fill="currentColor" stroke="none"/><circle cx="13" cy="6" r=".8" fill="currentColor" stroke="none"/>';
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
      }, "community-themes: settings icon");
    }

    const inject = ["slots", "connection", "theme"];
    function apply(ctx) {
      const theme = ctx.get("theme");
      const connection = ctx.get("connection");
      const registered = [];
      for (const definition of palettes) registered.push(theme.register({
        id: definition.id,
        colorScheme: "dark",
        tokens: tokenMap(definition.colors),
      }));
      ctx.effect(() => () => registered.reverse().forEach((dispose) => dispose()), "community-themes: registry");
      connection.rpc.call(CHANNEL, "get", {}).then(unwrap).then(({ preference }) => theme.setTheme(preference)).catch(() => {});
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-themes";
      style.textContent = ".communityThemesPage{max-width:760px}.communityThemesPage>p{color:var(--dsw-alias-label-secondary);line-height:1.55}.communityThemeGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:18px 0}.communityThemeOption{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;padding:13px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}.communityThemeOption:hover,.communityThemeOption[data-selected=true]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}.communityThemeOption strong{font-size:11px;color:var(--dsw-alias-brand-text)}.communityThemeSwatches{display:flex;overflow:hidden;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}.communityThemeSwatches i{display:block;width:12px;height:24px}.communityThemeError{color:var(--dsw-alias-label-error)}";
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "community-themes: styles");
      installSettingsNavIcon(ctx);
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "community-themes",
        order: 25,
        label: () => "Themes",
        inject: () => ({ rpc: connection.rpc, theme, subscribeTheme: (listener) => ctx.on("theme/change", listener) }),
      }, ThemeSection));
    }
    module.exports.apply = apply;
    module.exports.inject = inject;
    return module.exports;
  },
});
