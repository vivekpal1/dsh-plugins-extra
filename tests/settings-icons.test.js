import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clients = [
  {
    name: "Codex",
    path: new URL("../packages/dsh-codex-subscription/src/client.jsx", import.meta.url),
    marker: "codex-subscription",
    drawing: "M12 3.5c.5 3.2 2.3 5 5.5 5.5",
  },
  {
    name: "Import",
    path: new URL("../packages/dsh-session-import/lib/client.js", import.meta.url),
    marker: "session-import",
    drawing: "M12 3v11M8 10l4 4 4-4",
  },
  {
    name: "Themes",
    path: new URL("../dsh-themes/lib/client.js", import.meta.url),
    marker: "community-themes",
    drawing: "M12 3a9 9 0 1 0 0 18",
  },
  {
    name: "Wallets",
    path: new URL("../packages/dsh-solana-wallet/lib/client.js", import.meta.url),
    marker: "solana-wallet",
    drawing: "M4 7.5A2.5 2.5 0 0 1 6.5 5H18",
  },
  {
    name: "Telegram",
    path: new URL("../packages/dsh-telegram/lib/client.js", import.meta.url),
    marker: "dsh-telegram",
    drawing: "m21 3-7.4 18-4.2-7.1L3 10.7 21 3Z",
  },
];

for (const client of clients) {
  test(`${client.name} installs a scoped, accessible settings icon`, async () => {
    const source = await readFile(client.path, "utf8");
    assert.match(source, new RegExp(`marker = ["']${client.marker}["']`));
    assert.ok(source.includes(client.drawing));
    assert.match(source, /setAttribute\(["']stroke["'], ["']currentColor["']\)/);
    assert.match(source, /setAttribute\(["']aria-hidden["'], ["']true["']\)/);
    assert.match(source, /new MutationObserver\(render\)/);
    assert.match(source, /observer\.disconnect\(\)/);
  });
}

test("each settings section has a distinct icon drawing", () => {
  assert.equal(new Set(clients.map((client) => client.drawing)).size, clients.length);
});
