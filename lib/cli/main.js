import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { catalog, countPlugin, installedVersions, isNewerVersion, packageRoot, resolvePackages } from "./catalog.js";
import { createSystem } from "./system.js";
import packageJson from "../../package.json" with { type: "json" };

const PROFILE = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;

function help() {
  return `dsh-plugins-extra ${packageJson.version}

Install curated extensions for DeepSeek Harness.

Usage:
  dsh-plugins-extra list [--profile web] [--json]
  dsh-plugins-extra install <package...> [--profile web] [--dry-run]
  dsh-plugins-extra update <package...> [--profile web] [--dry-run]
  dsh-plugins-extra uninstall <package...> [--profile web] [--dry-run]
  dsh-plugins-extra verify [package...] [--profile web]
  dsh-plugins-extra doctor [--profile web]

Packages:
  codex     ChatGPT/Codex subscription provider
  import    Codex and Claude Code session importer
  wallet    Self-custodial Solana wallet
  themes    Catppuccin, Gruvbox, Nord, Tokyo Night, and Dracula
  terminal  Interactive shell in the current project directory
  telegram  Secure Telegram bot remote control for DSH sessions
  excalidraw  Live Excalidraw canvas tab and compact diagram tools
  all       Every package above

Examples:
  dsh-plugins-extra install import themes
  dsh-plugins-extra install codex wallet --profile web
  dsh-plugins-extra uninstall wallet

Options:
  --profile <name>  Select a DSH profile (default: web)
  --dry-run         Preview changes without installing or removing
  --verbose         Show package-manager output for troubleshooting
`;
}

export function parseArguments(argv) {
  const positionals = [];
  const options = { profile: process.env.DSH_PROFILE || "web", dryRun: false, json: false, verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--profile") {
      options.profile = argv[++index];
      if (!options.profile) throw new Error("--profile requires a value");
    } else if (value.startsWith("--profile=")) {
      options.profile = value.slice("--profile=".length);
    } else if (value === "--dry-run") options.dryRun = true;
    else if (value === "--verbose") options.verbose = true;
    else if (value === "--json") options.json = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else if (value === "--version" || value === "-v") options.version = true;
    else if (value.startsWith("-")) throw new Error(`Unknown option '${value}'`);
    else positionals.push(value);
  }
  if (!PROFILE.test(options.profile)) throw new Error("DSH profile must contain only letters, numbers, dots, underscores, and hyphens");
  return { command: positionals.shift(), packages: positionals, options };
}

function dumpConfig(system, profile) {
  return system.run("dsh", ["--profile", profile, "--dump-config"]).stdout;
}

function installedState(config) {
  return catalog.map((entry) => ({ ...entry, installedCount: countPlugin(config, entry.pluginId) }));
}

function printCatalog(entries, io) {
  for (const entry of entries) {
    const state = entry.installedCount === 1 ? "installed" : entry.installedCount > 1 ? `invalid (${entry.installedCount} entries)` : "not installed";
    io.out(`${entry.key.padEnd(8)} ${entry.version.padEnd(7)} ${state.padEnd(13)} ${entry.category}\n`);
    io.out(`         ${entry.summary}\n`);
  }
}

async function packPackage(system, entry, archiveDirectory) {
  const packageDirectory = resolve(packageRoot, entry.directory);
  const result = system.run("npm", ["pack", packageDirectory, "--pack-destination", archiveDirectory, "--silent"]);
  const archiveName = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  if (!archiveName || basename(archiveName) !== archiveName || !archiveName.endsWith(".tgz")) {
    throw new Error(`npm did not produce a valid archive for ${entry.packageName}`);
  }
  return join(archiveDirectory, archiveName);
}

async function install(entries, options, dependencies) {
  const { io, system, environment } = dependencies;
  const dshHome = environment.DSH_HOME || join(homedir(), ".dsh");
  const archiveDirectory = join(dshHome, "packages");
  const current = installedVersions(system.run("dsh", ["plugin", "--profile", options.profile, "list", "--depth=0"]).stdout);
  io.out(`DSH Plugins Extra ${packageJson.version}\nProfile: ${options.profile}\n\n`);
  io.out(`${options.dryRun ? "Plan" : "Selected"}: ${entries.map((entry) => `${entry.key} ${entry.version}`).join(", ")}\n`);
  for (const entry of entries) io.out(`  ${entry.key.padEnd(8)} ${entry.disclosure}\n`);
  io.out("\n");
  if (!options.dryRun) await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
  let changed = 0;
  for (const entry of entries) {
    const currentVersion = current.get(entry.packageName);
    if (currentVersion === entry.version) {
      io.out(`✓ ${entry.key} ${entry.version} is already installed\n`);
      continue;
    }
    if (currentVersion && isNewerVersion(currentVersion, entry.version)) {
      io.out(`! ${entry.key} ${currentVersion} is newer than bundled ${entry.version}; left unchanged\n`);
      continue;
    }
    if (options.dryRun) {
      io.out(`• ${currentVersion ? `Would update ${entry.key} ${currentVersion} to ${entry.version}` : `Would install ${entry.key} ${entry.version}`}\n`);
      continue;
    }
    const archive = await packPackage(system, entry, archiveDirectory);
    io.out(`${currentVersion ? `Updating ${entry.key} ${currentVersion} to ${entry.version}` : `Installing ${entry.key} ${entry.version}`}…\n`);
    system.run("dsh", ["plugin", "--profile", options.profile, "add", archive], { inherit: options.verbose });
    const count = countPlugin(dumpConfig(system, options.profile), entry.pluginId);
    if (count !== 1) throw new Error(`Installation verification failed for ${entry.packageName}: expected one plugin entry, found ${count}`);
    changed += 1;
    io.out(`✓ ${entry.key} ${entry.version} installed and verified\n`);
  }
  if (options.dryRun) io.out("\nNo changes were made.\n");
  else if (changed === 0) io.out("\nNo changes. The selected extensions are already up to date.\n");
  else io.out(`\nDone. ${changed} ${changed === 1 ? "extension" : "extensions"} changed. Restart DSH to load the new versions.\n`);
}

async function uninstall(entries, options, dependencies) {
  const { io, system } = dependencies;
  for (const entry of entries) {
    if (options.dryRun) {
      io.out(`Would remove ${entry.packageName} from DSH profile '${options.profile}'.\n`);
      continue;
    }
    io.out(`Removing ${entry.packageName} from DSH profile '${options.profile}'…\n`);
    system.run("dsh", ["plugin", "--profile", options.profile, "remove", entry.packageName], { inherit: options.verbose });
    const count = countPlugin(dumpConfig(system, options.profile), entry.pluginId);
    if (count !== 0) throw new Error(`Removal verification failed for ${entry.packageName}: found ${count} plugin entries`);
    io.out(`Removed ${entry.packageName}.\n`);
  }
  if (!options.dryRun) io.out("Restart DSH to finish unloading removed extensions.\n");
}

function verify(entries, options, dependencies, allowAbsent = false) {
  const config = dumpConfig(dependencies.system, options.profile);
  let valid = true;
  for (const entry of entries) {
    const count = countPlugin(config, entry.pluginId);
    const okay = count === 1 || (allowAbsent && count === 0);
    dependencies.io.out(`${okay ? "ok" : "error"}  ${entry.key}: ${count === 0 ? "not installed" : `${count} plugin ${count === 1 ? "entry" : "entries"}`}\n`);
    valid &&= okay;
  }
  return valid ? 0 : 1;
}

export async function main(argv, overrides = {}) {
  const parsed = parseArguments(argv);
  const dependencies = {
    environment: overrides.environment ?? process.env,
    system: overrides.system ?? createSystem(overrides.environment ?? process.env),
    io: overrides.io ?? { out: (value) => process.stdout.write(value), err: (value) => process.stderr.write(value) },
  };
  const { command, packages, options } = parsed;
  if (options.version) {
    dependencies.io.out(`${packageJson.version}\n`);
    return 0;
  }
  if (options.help || !command) {
    dependencies.io.out(help());
    return 0;
  }
  if (command === "list") {
    if (packages.length) throw new Error("list does not accept package names");
    const entries = installedState(dumpConfig(dependencies.system, options.profile));
    if (options.json) dependencies.io.out(`${JSON.stringify(entries.map(({ key, packageName, version, category, summary, disclosure, installedCount }) => ({ key, packageName, version, category, summary, disclosure, installedCount })), null, 2)}\n`);
    else printCatalog(entries, dependencies.io);
    return entries.some((entry) => entry.installedCount > 1) ? 1 : 0;
  }
  if (command === "install" || command === "update") {
    await install(resolvePackages(packages), options, dependencies);
    return 0;
  }
  if (command === "uninstall" || command === "remove") {
    await uninstall(resolvePackages(packages), options, dependencies);
    return 0;
  }
  if (command === "verify") {
    const entries = packages.length ? resolvePackages(packages) : catalog;
    return verify(entries, options, dependencies, packages.length === 0);
  }
  if (command === "doctor") {
    if (packages.length) throw new Error("doctor does not accept package names");
    dependencies.system.run("npm", ["--version"]);
    dependencies.io.out(`ok  npm is available\n`);
    const result = verify(catalog, options, dependencies, true);
    dependencies.io.out(`ok  DSH profile '${options.profile}' is readable\n`);
    return result;
  }
  throw new Error(`Unknown command '${command}'. Run dsh-plugins-extra --help`);
}
