import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { countPlugin, resolvePackages } from "../lib/cli/catalog.js";
import { main, parseArguments } from "../lib/cli/main.js";

test("CLI resolves aliases, comma lists, all, and duplicate selections", () => {
  assert.deepEqual(resolvePackages(["session-import", "theme,themes"]).map((entry) => entry.key), ["import", "themes"]);
  assert.deepEqual(resolvePackages(["all"]).map((entry) => entry.key), ["codex", "import", "wallet", "themes", "terminal", "telegram", "excalidraw"]);
  assert.deepEqual(resolvePackages(["draw", "dsh-excalidraw"]).map((entry) => entry.key), ["excalidraw"]);
  assert.deepEqual(resolvePackages(["tg", "dsh-telegram"]).map((entry) => entry.key), ["telegram"]);
  assert.throws(() => resolvePackages(["unknown"]), /Unknown package/u);
  assert.match(resolvePackages(["import"])[0].version, /^\d+\.\d+\.\d+$/u);
});

test("CLI parses profile and dry-run options without accepting unsafe profiles", () => {
  assert.deepEqual(parseArguments(["install", "import", "themes", "--profile", "personal-web", "--dry-run"]), {
    command: "install",
    packages: ["import", "themes"],
    options: { profile: "personal-web", dryRun: true, json: false, verbose: false },
  });
  assert.throws(() => parseArguments(["list", "--profile", "../web"]), /DSH profile/u);
});

test("plugin verification counts exact config entries", () => {
  assert.equal(countPlugin("- id: session-import\n  id: community-themes\nnote: id: session-import\n", "session-import"), 1);
});

test("multi-package install packs reviewed local packages and verifies DSH", async () => {
  const calls = [];
  const installed = new Set();
  const system = {
    run(name, args, options) {
      calls.push([name, ...args]);
      if (name === "npm" && args[0] === "pack") {
        const directory = args[1];
        if (directory.endsWith("dsh-session-import")) return { stdout: "dsh-session-import-0.2.0.tgz\n", stderr: "" };
        if (directory.endsWith("dsh-themes")) return { stdout: "dsh-themes-0.1.1.tgz\n", stderr: "" };
      }
      if (name === "dsh" && args[0] === "plugin" && args[3] === "list") return { stdout: "", stderr: "" };
      if (name === "dsh" && args[0] === "plugin" && args[3] === "add") {
        assert.deepEqual(options, { inherit: false });
        if (args[4].includes("session-import")) installed.add("session-import");
        if (args[4].includes("themes")) installed.add("community-themes");
        return { stdout: "", stderr: "" };
      }
      if (name === "dsh" && args.includes("--dump-config")) {
        return { stdout: [...installed].map((id) => `id: ${id}`).join("\n"), stderr: "" };
      }
      throw new Error(`Unexpected command: ${name} ${args.join(" ")}`);
    },
  };
  let output = "";
  const code = await main(["install", "import", "themes"], {
    system,
    environment: { DSH_HOME: await mkdtemp(join(tmpdir(), "dsh-cli-")) },
    io: { out: (value) => { output += value; }, err: () => {} },
  });
  assert.equal(code, 0);
  assert.deepEqual([...installed], ["session-import", "community-themes"]);
  assert.match(output, /Hidden prompts, reasoning, and tool payloads/u);
  assert.match(output, /can be reversed at any time/u);
  assert.equal(calls.filter(([name, action]) => name === "npm" && action === "pack").length, 2);
});

test("install keeps known package-manager warnings quiet and skips current versions", async () => {
  const calls = [];
  const system = {
    run(name, args) {
      calls.push([name, ...args]);
      if (name === "dsh" && args[0] === "plugin" && args[3] === "list") {
        return { stdout: "dsh-codex-subscription 0.3.1\ndsh-solana-wallet 0.2.0\ndsh-themes 0.1.1\n", stderr: "" };
      }
      throw new Error("Package manager should not run for current versions");
    },
  };
  let output = "";
  const code = await main(["install", "codex", "wallet", "themes"], {
    system,
    environment: {},
    io: { out: (value) => { output += value; }, err: () => {} },
  });
  assert.equal(code, 0);
  assert.match(output, /codex 0\.3\.1 is already installed/u);
  assert.match(output, /No changes\. The selected extensions are already up to date\./u);
  assert.doesNotMatch(output, /peer dependencies|aesscr|Progress:/u);
  assert.equal(calls.length, 1);
});
