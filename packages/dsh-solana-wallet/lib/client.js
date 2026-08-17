window.__ModuleLoader__.load({
  id: "dsh-solana-wallet",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const { Button, Input, RiskConfirmation } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;
    const CHANNEL = "/solana-wallet";

    function unwrap(result) {
      if (result?.ok === true) return result.value;
      throw new Error(result?.error?.message ?? "Wallet request failed");
    }

    function Field({ label, children, hint }) {
      return h("label", { className: "solanaWalletField" },
        h("span", null, label),
        children,
        hint ? h("small", null, hint) : null);
    }

    function RecoveryPhrase({ phrase, onHide }) {
      const [saved, setSaved] = React.useState(false);
      return h("section", { className: "solanaWalletRecovery", role: "status" },
        h("h3", null, "Back up this recovery phrase now"),
        h("p", null, "Write these words down in order and keep them offline. Anyone with this phrase controls the wallet. DSH will not show it to an agent."),
        h("ol", { className: "solanaWalletWords" }, phrase.split(" ").map((word, index) => h("li", { key: `${index}-${word}` }, h("span", null, index + 1), word))),
        h("label", { className: "solanaWalletCheck" },
          h("input", { type: "checkbox", checked: saved, onChange: (event) => setSaved(event.currentTarget.checked) }),
          h("span", null, "I saved the recovery phrase offline")),
        h(Button, { type: "button", variant: "primary", disabled: !saved, onClick: onHide }, "Finish setup"));
    }

    function SetupWallet({ rpc, onReady }) {
      const [mode, setMode] = React.useState("create");
      const [password, setPassword] = React.useState("");
      const [confirmation, setConfirmation] = React.useState("");
      const [mnemonic, setMnemonic] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState();
      const [createdPhrase, setCreatedPhrase] = React.useState();
      if (createdPhrase) return h(RecoveryPhrase, { phrase: createdPhrase, onHide: onReady });
      const submit = async (event) => {
        event.preventDefault();
        setError(undefined);
        if (password.length < 12) return setError("Use a wallet password with at least 12 characters");
        if (password !== confirmation) return setError("Wallet passwords do not match");
        setBusy(true);
        try {
          const value = await rpc.call(CHANNEL, mode, { password, ...(mode === "import" ? { mnemonic } : {}) }).then(unwrap);
          setPassword("");
          setConfirmation("");
          setMnemonic("");
          if (value.mnemonic) setCreatedPhrase(value.mnemonic);
          else onReady();
        } catch (cause) {
          setError(cause.message);
        } finally {
          setBusy(false);
        }
      };
      return h("section", { className: "solanaWalletSetup" },
        h("div", { className: "solanaWalletTabs", "aria-label": "Wallet setup method" },
          h("button", { type: "button", "aria-pressed": mode === "create", onClick: () => setMode("create") }, "Create wallet"),
          h("button", { type: "button", "aria-pressed": mode === "import", onClick: () => setMode("import") }, "Import wallet")),
        h("p", null, mode === "create"
          ? "Create a new 24-word self-custodial Solana wallet. It starts on devnet."
          : "Restore the first Solana account at m/44'/501'/0'/0' from a BIP39 English recovery phrase."),
        h("form", { onSubmit: submit, className: "solanaWalletCard", "aria-busy": busy },
          mode === "import" ? h(Field, { label: "Recovery phrase (required)" }, h("textarea", { value: mnemonic, onChange: (event) => setMnemonic(event.currentTarget.value), rows: 4, autoComplete: "off", spellCheck: false, required: true })) : null,
          h(Field, { label: "Wallet password (required)", hint: "Used locally to encrypt the recovery phrase. It cannot be recovered." }, h(Input, { type: "password", value: password, onChange: (event) => setPassword(event.currentTarget.value), autoComplete: "new-password", minLength: 12, required: true })),
          h(Field, { label: "Confirm password (required)" }, h(Input, { type: "password", value: confirmation, onChange: (event) => setConfirmation(event.currentTarget.value), autoComplete: "new-password", minLength: 12, required: true })),
          error ? h("p", { className: "solanaWalletError", role: "alert" }, error) : null,
          h(Button, { type: "submit", variant: "primary", disabled: busy || (mode === "import" && !mnemonic.trim()) }, busy ? "Securing wallet…" : mode === "create" ? "Create wallet" : "Import wallet")));
    }

    function WalletDashboard({ rpc, initialStatus, reloadStatus }) {
      const [status, setStatus] = React.useState(initialStatus);
      const [balance, setBalance] = React.useState();
      const [transactions, setTransactions] = React.useState([]);
      const [password, setPassword] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState();
      const [send, setSend] = React.useState({ recipient: "", amountSol: "" });
      const [pendingSend, setPendingSend] = React.useState();
      const [lastSend, setLastSend] = React.useState();
      const [sendAcknowledged, setSendAcknowledged] = React.useState(false);
      const [pendingMainnet, setPendingMainnet] = React.useState(false);
      const [mainnetAcknowledged, setMainnetAcknowledged] = React.useState(false);
      const [revealedPhrase, setRevealedPhrase] = React.useState();
      const [revealPending, setRevealPending] = React.useState(false);
      const [revealAcknowledged, setRevealAcknowledged] = React.useState(false);
      const [deletePending, setDeletePending] = React.useState(false);
      const [deleteAcknowledged, setDeleteAcknowledged] = React.useState(false);
      const [copied, setCopied] = React.useState(false);

      const refreshPublic = React.useCallback(async () => {
        try {
          const [nextBalance, nextTransactions] = await Promise.all([
            rpc.call(CHANNEL, "balance", {}).then(unwrap),
            rpc.call(CHANNEL, "transactions", { limit: 10 }).then(unwrap),
          ]);
          setBalance(nextBalance);
          setTransactions(nextTransactions.transactions);
        } catch (cause) {
          setError(cause.message);
        }
      }, [rpc, status.network]);

      React.useEffect(() => { void refreshPublic(); }, [refreshPublic]);
      const updateStatus = async () => {
        const next = await reloadStatus();
        setStatus(next);
        return next;
      };
      const act = async (task) => {
        setBusy(true);
        setError(undefined);
        try { return await task(); }
        catch (cause) { setError(cause.message); }
        finally { setBusy(false); }
      };
      const unlock = (event) => {
        event.preventDefault();
        void act(async () => {
          await rpc.call(CHANNEL, "unlock", { password }).then(unwrap);
          setPassword("");
          await updateStatus();
        });
      };
      const lock = () => void act(async () => {
        await rpc.call(CHANNEL, "lock", {}).then(unwrap);
        setRevealedPhrase(undefined);
        await updateStatus();
      });
      const networkChange = (event) => {
        const network = event.currentTarget.value;
        if (network === "mainnet-beta") setPendingMainnet(true);
        else void act(async () => {
          await rpc.call(CHANNEL, "set-network", { network }).then(unwrap);
          await updateStatus();
          await refreshPublic();
        });
      };
      const confirmMainnet = () => void act(async () => {
        await rpc.call(CHANNEL, "set-network", { network: "mainnet-beta", acknowledgeMainnet: true }).then(unwrap);
        setPendingMainnet(false);
        setMainnetAcknowledged(false);
        await updateStatus();
        await refreshPublic();
      });
      const submitSend = (event) => {
        event.preventDefault();
        if (!status.unlocked) return setError("Unlock the wallet before sending SOL");
        void act(async () => {
          const preview = await rpc.call(CHANNEL, "prepare-send", send).then(unwrap);
          setPendingSend({ ...send, preview });
        });
      };
      const confirmSend = () => void act(async () => {
        const result = await rpc.call(CHANNEL, "send", {
          recipient: pendingSend.recipient,
          amountSol: pendingSend.amountSol,
          expectedNetwork: pendingSend.preview.network,
        }).then(unwrap);
        setPendingSend(undefined);
        setSendAcknowledged(false);
        setSend({ recipient: "", amountSol: "" });
        setLastSend(result);
        await refreshPublic();
        setError(undefined);
      });
      const confirmReveal = () => void act(async () => {
        const result = await rpc.call(CHANNEL, "reveal", { password }).then(unwrap);
        setRevealedPhrase(result.mnemonic);
        setRevealPending(false);
        setRevealAcknowledged(false);
        setPassword("");
      });
      const confirmDelete = () => void act(async () => {
        await rpc.call(CHANNEL, "delete", { password }).then(unwrap);
        setDeletePending(false);
        setDeleteAcknowledged(false);
        setPassword("");
        await reloadStatus();
      });
      const copyAddress = async () => {
        try { await navigator.clipboard.writeText(status.address); setCopied(true); }
        catch { setError("Could not copy the wallet address"); }
      };
      const displayAddress = `${status.address.slice(0, 8)}…${status.address.slice(-8)}`;

      return h("div", { className: "solanaWalletDashboard" },
        h("section", { className: "solanaWalletCard solanaWalletAccount" },
          h("div", null,
            h("span", { className: "solanaWalletEyebrow" }, status.network === "devnet" ? "Solana Devnet" : "Solana Mainnet Beta"),
            h("strong", null, balance ? `${balance.balanceSol} SOL` : "Loading balance…"),
            h("code", { title: status.address }, displayAddress)),
          h("div", { className: "solanaWalletActions" },
            h(Button, { type: "button", variant: "outline", onClick: copyAddress }, copied ? "Copied" : "Copy address"),
            h(Button, { type: "button", variant: "outline", onClick: refreshPublic, disabled: busy }, "Refresh"))),
        h("section", { className: "solanaWalletGrid" },
          h("div", { className: "solanaWalletCard" },
            h("h3", null, "Network"),
            h("p", null, status.network === "devnet" ? "Devnet uses test SOL with no monetary value." : "Mainnet transactions use real SOL and are irreversible."),
            h("select", { value: status.network, onChange: networkChange, disabled: busy },
              h("option", { value: "devnet" }, "Devnet"),
              h("option", { value: "mainnet-beta" }, "Mainnet Beta"))),
          h("div", { className: "solanaWalletCard" },
            h("h3", null, status.unlocked ? "Wallet unlocked" : "Wallet locked"),
            h("p", null, status.unlocked ? "Signing is available in memory for 5 minutes." : "Unlock before sending or using a signing tool."),
            status.unlocked
              ? h(Button, { type: "button", variant: "outline", onClick: lock, disabled: busy }, "Lock now")
              : h("form", { onSubmit: unlock, className: "solanaWalletInline" },
                h(Input, { type: "password", value: password, onChange: (event) => setPassword(event.currentTarget.value), placeholder: "Wallet password", autoComplete: "current-password", required: true }),
                h(Button, { type: "submit", variant: "primary", disabled: busy }, "Unlock")))),
        h("section", { className: "solanaWalletCard" },
          h("h3", null, "Send SOL"),
          h("form", { onSubmit: submitSend, className: "solanaWalletSend", "aria-busy": busy },
            h(Field, { label: "Recipient address (required)" }, h(Input, { value: send.recipient, onChange: (event) => setSend({ ...send, recipient: event.currentTarget.value }), autoComplete: "off", spellCheck: false, required: true })),
            h(Field, { label: "Amount in SOL (required)" }, h(Input, { type: "text", inputMode: "decimal", value: send.amountSol, onChange: (event) => setSend({ ...send, amountSol: event.currentTarget.value }), placeholder: "0.01", autoComplete: "off", required: true })),
            h(Button, { type: "submit", variant: "primary", disabled: busy || !status.unlocked }, "Review transfer")),
          lastSend ? h("p", { className: "solanaWalletSuccess", role: "status" }, `Sent ${lastSend.amountSol} SOL. `, h("a", { href: lastSend.explorerUrl, target: "_blank", rel: "noreferrer" }, "View transaction")) : null),
        error ? h("p", { className: "solanaWalletError", role: "alert" }, error) : null,
        revealedPhrase ? h(RecoveryPhrase, { phrase: revealedPhrase, onHide: () => setRevealedPhrase(undefined) }) : null,
        h("section", { className: "solanaWalletCard" },
          h("div", { className: "solanaWalletSectionHead" }, h("div", null, h("h3", null, "Recent transactions"), h("p", null, "Public history for this address.")), h(Button, { type: "button", variant: "outline", onClick: refreshPublic, disabled: busy }, "Refresh")),
          transactions.length === 0 ? h("p", { className: "solanaWalletEmpty" }, "No recent transactions on this network.") : h("ul", { className: "solanaWalletTransactions" }, transactions.map((transaction) => h("li", { key: transaction.signature },
            h("div", null, h("strong", null, transaction.direction), transaction.changeSol ? h("span", null, `${transaction.changeSol} SOL`) : null),
            h("a", { href: transaction.explorerUrl, target: "_blank", rel: "noreferrer" }, `${transaction.signature.slice(0, 10)}…${transaction.signature.slice(-8)}`))))),
        h("section", { className: "solanaWalletCard solanaWalletDanger" },
          h("h3", null, "Recovery and removal"),
          h("p", null, "The password is required to reveal the recovery phrase or remove the encrypted wallet."),
          h(Input, { type: "password", value: password, onChange: (event) => setPassword(event.currentTarget.value), placeholder: "Wallet password", autoComplete: "current-password" }),
          h("div", { className: "solanaWalletActions" },
            h(Button, { type: "button", variant: "outline", disabled: busy || password.length < 12, onClick: () => setRevealPending(true) }, "Reveal recovery phrase"),
            h(Button, { type: "button", variant: "outline", disabled: busy || password.length < 12, onClick: () => setDeletePending(true) }, "Remove wallet"))),
        h(RiskConfirmation, {
          open: pendingSend !== undefined,
          title: "Confirm SOL transfer",
          description: pendingSend ? `Send ${pendingSend.preview.amountSol} SOL to ${pendingSend.preview.recipient} on ${pendingSend.preview.network}? Estimated network fee: ${pendingSend.preview.feeSol} SOL. Total: ${pendingSend.preview.totalSol} SOL. Simulation passed. Blockchain transactions cannot be reversed.` : "",
          acknowledgeLabel: "I checked the network, address, and amount",
          cancelLabel: "Cancel",
          confirmLabel: "Send SOL",
          acknowledged: sendAcknowledged,
          disabled: busy,
          onAcknowledgedChange: setSendAcknowledged,
          onCancel: () => { setPendingSend(undefined); setSendAcknowledged(false); },
          onConfirm: confirmSend,
        }),
        h(RiskConfirmation, {
          open: pendingMainnet,
          title: "Switch to Solana mainnet",
          description: "Mainnet uses assets with real monetary value. Future approved transfers will broadcast to Solana Mainnet Beta.",
          acknowledgeLabel: "I understand mainnet uses real funds",
          cancelLabel: "Stay on devnet",
          confirmLabel: "Use mainnet",
          acknowledged: mainnetAcknowledged,
          disabled: busy,
          onAcknowledgedChange: setMainnetAcknowledged,
          onCancel: () => { setPendingMainnet(false); setMainnetAcknowledged(false); },
          onConfirm: confirmMainnet,
        }),
        h(RiskConfirmation, {
          open: revealPending,
          title: "Reveal recovery phrase",
          description: "The recovery phrase grants complete control of this wallet. Make sure nobody can see your screen and never paste it into a chat.",
          acknowledgeLabel: "I am in a private place",
          cancelLabel: "Cancel",
          confirmLabel: "Reveal phrase",
          acknowledged: revealAcknowledged,
          disabled: busy,
          onAcknowledgedChange: setRevealAcknowledged,
          onCancel: () => { setRevealPending(false); setRevealAcknowledged(false); },
          onConfirm: confirmReveal,
        }),
        h(RiskConfirmation, {
          open: deletePending,
          title: "Remove encrypted wallet",
          description: "This removes the encrypted wallet from DSH. It cannot be restored without the recovery phrase.",
          acknowledgeLabel: "I have backed up the recovery phrase",
          cancelLabel: "Cancel",
          confirmLabel: "Remove wallet",
          acknowledged: deleteAcknowledged,
          disabled: busy,
          onAcknowledgedChange: setDeleteAcknowledged,
          onCancel: () => { setDeletePending(false); setDeleteAcknowledged(false); },
          onConfirm: confirmDelete,
        }));
    }

    function WalletSection({ rpc }) {
      const [status, setStatus] = React.useState();
      const [error, setError] = React.useState();
      const load = React.useCallback(async () => {
        const next = await rpc.call(CHANNEL, "status", {}).then(unwrap);
        setStatus(next);
        return next;
      }, [rpc]);
      React.useEffect(() => { void load().catch((cause) => setError(cause.message)); }, [load]);
      if (status === undefined && error) return h("section", { className: "solanaWalletPage" },
        h("h2", null, "Solana wallet"),
        h("p", { className: "solanaWalletError", role: "alert" }, error),
        h(Button, { type: "button", variant: "outline", onClick: () => { setError(undefined); void load().catch((cause) => setError(cause.message)); } }, "Try again"));
      return h("section", { className: "solanaWalletPage" },
        h("div", { className: "solanaWalletTitle" }, h("div", null, h("h2", null, "Solana wallet"), h("p", null, "Self-custodial wallet actions for DSH sessions, protected by local encryption and explicit approvals."))),
        error ? h("p", { className: "solanaWalletError", role: "alert" }, error) : null,
        status === undefined ? h("div", { className: "solanaWalletSkeleton", role: "status", "aria-label": "Loading wallet" }, h("i"), h("i"), h("i"))
          : status.configured
            ? h(WalletDashboard, { key: status.address, rpc, initialStatus: status, reloadStatus: load })
            : h(SetupWallet, { rpc, onReady: load }));
    }

    function installSettingsNavIcon(ctx) {
      const marker = "solana-wallet";
      const originals = new Map();
      const render = () => {
        for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
          const label = [...button.children].find((child) => child.tagName === "SPAN");
          if (label?.textContent?.trim() !== "Wallets") continue;
          if (button.dataset.dshPluginIcon && button.dataset.dshPluginIcon !== marker) continue;
          const current = button.querySelector("svg");
          if (!current || current.dataset.dshPluginIcon === marker) continue;
          if (!originals.has(button)) originals.set(button, current.cloneNode(true));
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          for (const attribute of ["class", "width", "height", "style"]) {
            const value = current.getAttribute(attribute);
            if (value !== null) icon.setAttribute(attribute, value);
          }
          for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", focusable: "false" })) icon.setAttribute(name, value);
          icon.setAttribute("stroke", "currentColor");
          icon.setAttribute("aria-hidden", "true");
          icon.dataset.dshPluginIcon = marker;
          icon.innerHTML = '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 17.5v-10Z"/><path d="M4 8h14M15 12h5v4h-5a2 2 0 0 1 0-4Z"/><circle cx="15.5" cy="14" r=".6" fill="currentColor" stroke="none"/>';
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
      }, "solana-wallet: settings icon");
    }

    const inject = ["slots", "connection"];
    function apply(ctx) {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-solana-wallet";
      style.textContent = ".solanaWalletPage{max-width:820px}.solanaWalletTitle p,.solanaWalletPage p{color:var(--dsw-alias-label-secondary);line-height:1.5}.solanaWalletCard{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.solanaWalletCard h3{margin:0 0 6px}.solanaWalletSetup,.solanaWalletDashboard{display:grid;gap:14px}.solanaWalletTabs{display:flex;gap:6px}.solanaWalletTabs button{min-height:40px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}.solanaWalletTabs button[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-active)}.solanaWalletField{display:grid;gap:6px;font-weight:600}.solanaWalletField small{color:var(--dsw-alias-label-tertiary);font-weight:400}.solanaWalletField textarea,.solanaWalletCard select{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:10px;font:inherit}.solanaWalletSetup form,.solanaWalletSend{display:grid;gap:14px}.solanaWalletRecovery{padding:18px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.solanaWalletWords{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;padding:0;list-style:none}.solanaWalletWords li{display:flex;gap:7px;padding:8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-family:monospace}.solanaWalletWords li span{color:var(--dsw-alias-label-tertiary)}.solanaWalletCheck{display:flex;align-items:center;gap:8px;margin:14px 0}.solanaWalletCheck input{width:18px;height:18px}.solanaWalletAccount,.solanaWalletAccount>div,.solanaWalletSectionHead,.solanaWalletActions{display:flex;align-items:center;justify-content:space-between;gap:10px}.solanaWalletAccount>div:first-child{align-items:flex-start;flex-direction:column}.solanaWalletAccount strong{font-size:24px;font-variant-numeric:tabular-nums}.solanaWalletAccount code{overflow-wrap:anywhere}.solanaWalletEyebrow{color:var(--dsw-alias-brand-text);font-size:12px;font-weight:700}.solanaWalletGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.solanaWalletInline{display:flex;gap:8px}.solanaWalletTransactions{display:grid;gap:1px;padding:0;list-style:none}.solanaWalletTransactions li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-separator-primary)}.solanaWalletTransactions li div{display:flex;gap:8px;text-transform:capitalize;font-variant-numeric:tabular-nums}.solanaWalletTransactions a,.solanaWalletSuccess a{color:var(--dsw-alias-brand-text)}.solanaWalletError{color:var(--dsw-alias-label-error)!important}.solanaWalletSuccess{color:var(--dsw-alias-state-success-primary)!important}.solanaWalletEmpty{margin-bottom:0}.solanaWalletDanger{display:grid;gap:10px}.solanaWalletDanger p{margin:0}.solanaWalletSkeleton{display:grid;gap:10px;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}.solanaWalletSkeleton i{display:block;height:18px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}.solanaWalletSkeleton i:nth-child(2){width:70%}.solanaWalletSkeleton i:nth-child(3){width:45%}@media(max-width:700px){.solanaWalletGrid{grid-template-columns:1fr}.solanaWalletWords{grid-template-columns:repeat(2,minmax(0,1fr))}.solanaWalletAccount,.solanaWalletSectionHead{align-items:flex-start;flex-direction:column}.solanaWalletActions{flex-wrap:wrap}.solanaWalletInline{align-items:stretch;flex-direction:column}}";
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "solana-wallet: styles");
      installSettingsNavIcon(ctx);
      const connection = ctx.get("connection");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "solana-wallet",
        order: 18,
        label: () => "Wallets",
        inject: () => ({ rpc: connection.rpc }),
      }, WalletSection));
    }
    module.exports.apply = apply;
    module.exports.inject = inject;
    return module.exports;
  },
});
