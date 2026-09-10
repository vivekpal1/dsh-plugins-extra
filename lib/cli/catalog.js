import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function packageVersion(directory) {
  return JSON.parse(readFileSync(resolve(packageRoot, directory, "package.json"), "utf8")).version;
}

export const catalog = Object.freeze([
  Object.freeze({
    key: "codex",
    aliases: Object.freeze(["codex", "codex-subscription", "dsh-codex-subscription"]),
    packageName: "dsh-codex-subscription",
    version: packageVersion("packages/dsh-codex-subscription"),
    pluginId: "codex-subscription",
    directory: "packages/dsh-codex-subscription",
    category: "Credentials and model provider",
    summary: "Use a ChatGPT/Codex subscription from DSH.",
    disclosure: "Adds OAuth credentials and a Codex model provider. Review account and provider behavior independently.",
  }),
  Object.freeze({
    key: "import",
    aliases: Object.freeze(["import", "session-import", "dsh-session-import"]),
    packageName: "dsh-session-import",
    version: packageVersion("packages/dsh-session-import"),
    pluginId: "session-import",
    directory: "packages/dsh-session-import",
    category: "Context provenance",
    summary: "Import visible Codex and Claude Code conversations.",
    disclosure: "Creates DSH context from local session history. Hidden prompts, reasoning, and tool payloads are intentionally omitted.",
  }),
  Object.freeze({
    key: "wallet",
    aliases: Object.freeze(["wallet", "wallets", "solana-wallet", "dsh-solana-wallet"]),
    packageName: "dsh-solana-wallet",
    version: packageVersion("packages/dsh-solana-wallet"),
    pluginId: "solana-wallet",
    directory: "packages/dsh-solana-wallet",
    category: "Self-custody and transactions",
    summary: "Create and use an encrypted self-custodial Solana wallet.",
    disclosure: "Can sign native SOL transfers after explicit approval. Experimental and unaudited; devnet is the default.",
  }),
  Object.freeze({
    key: "themes",
    aliases: Object.freeze(["theme", "themes", "dsh-themes"]),
    packageName: "dsh-themes",
    version: packageVersion("dsh-themes"),
    pluginId: "community-themes",
    directory: "dsh-themes",
    category: "Reversible interface",
    summary: "Add five community color themes to DSH.",
    disclosure: "Changes only local interface preferences and can be reversed at any time.",
  }),
  Object.freeze({
    key: "terminal",
    aliases: Object.freeze(["terminal", "term", "dsh-terminal"]),
    packageName: "dsh-terminal",
    version: packageVersion("packages/dsh-terminal"),
    pluginId: "terminal",
    directory: "packages/dsh-terminal",
    category: "Interactive terminal",
    summary: "Open a shell in the current session workspace.",
    disclosure: "Runs shell commands as the local user in your session's project directory. Commands are not sandboxed.",
  }),
  Object.freeze({
    key: "telegram",
    aliases: Object.freeze(["telegram", "tg", "telegram-remote", "dsh-telegram"]),
    packageName: "dsh-telegram",
    version: packageVersion("packages/dsh-telegram"),
    pluginId: "telegram-remote",
    directory: "packages/dsh-telegram",
    category: "Authenticated remote control",
    summary: "Control selected DSH sessions from a paired Telegram bot, including photos and files.",
    disclosure: "Paired Telegram users can submit prompts and receive session text remotely. Access is deny-by-default and should be granted only to trusted accounts.",
  }),
  Object.freeze({
    key: "excalidraw",
    aliases: Object.freeze(["excalidraw", "draw", "canvas", "dsh-excalidraw"]),
    packageName: "dsh-excalidraw",
    version: packageVersion("packages/dsh-excalidraw"),
    pluginId: "excalidraw",
    directory: "packages/dsh-excalidraw",
    category: "Live canvas",
    summary: "Draw diagrams in an Excalidraw tab with compact agent tools.",
    disclosure: "Adds a conversation canvas tab and three diagram tools. Scenes are saved as .excalidraw files in the session project directory.",
  }),
]);

const byAlias = new Map(catalog.flatMap((entry) => entry.aliases.map((alias) => [alias, entry])));

export function resolvePackages(values) {
  const requested = values.flatMap((value) => value.split(",")).map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (requested.length === 0) throw new Error("Choose at least one package: codex, import, wallet, themes, terminal, telegram, or excalidraw");
  const expanded = requested.includes("all") ? catalog : requested.map((value) => {
    const entry = byAlias.get(value);
    if (!entry) throw new Error(`Unknown package '${value}'. Choose codex, import, wallet, themes, terminal, telegram, excalidraw, or all`);
    return entry;
  });
  return [...new Map(expanded.map((entry) => [entry.key, entry])).values()];
}

export function countPlugin(config, pluginId) {
  return config.split(/\r?\n/u).filter((line) => {
    const normalized = line.trim();
    return normalized === `id: ${pluginId}` || normalized === `- id: ${pluginId}`;
  }).length;
}

export function installedVersions(output) {
  const versions = new Map();
  for (const entry of catalog) {
    const line = output.split(/\r?\n/u).find((value) => value.trim().startsWith(`${entry.packageName} `));
    const version = line?.trim().slice(entry.packageName.length).trim();
    if (version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) versions.set(entry.packageName, version);
  }
  return versions;
}

export function isNewerVersion(current, bundled) {
  const parse = (value) => /^(\d+)\.(\d+)\.(\d+)/u.exec(value)?.slice(1).map(Number);
  const left = parse(current);
  const right = parse(bundled);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}
