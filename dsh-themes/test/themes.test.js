import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isThemeId, themeIds, themes } from "../lib/themes.js";

test("ships five unique complete themes", () => {
  assert.equal(themes.length, 5);
  assert.equal(new Set(themes.map((theme) => theme.id)).size, themes.length);
  for (const theme of themes) {
    assert.equal(theme.colorScheme, "dark");
    assert.equal(theme.preview.length, 4);
    assert.ok(Object.keys(theme.tokens).length >= 40);
    assert.ok(Object.keys(theme.tokens).every((key) => key.startsWith("--dsw-alias-")));
  }
});

test("validates persisted preferences", () => {
  assert.deepEqual(themeIds, ["system", "catppuccin-mocha", "gruvbox-dark", "nord", "tokyo-night", "dracula"]);
  assert.equal(isThemeId("nord"), true);
  assert.equal(isThemeId("unknown"), false);
});

test("browser bundle contains every registered theme", async () => {
  const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  for (const theme of themes) assert.match(client, new RegExp(`id: \\"${theme.id}\\"`));
});
