import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createWalletTools, requireTransferApproval, WALLET_SEND_TOOL } from "../lib/tools.js";

test("all four wallet tools compile through DSH's value-schema DSL", () => {
  const tools = createWalletTools({
    vault: { status: async () => ({ configured: true, address: "WalletAddress" }) },
    wallet: {
      explorerAddress: () => "https://explorer.solana.com/address/WalletAddress",
      balance: async () => ({}),
      transactions: async () => ({}),
      send: async () => ({}),
    },
    getNetwork: () => "devnet",
  });
  assert.equal(tools.length, 4);
});

test("every session transfer requires DSH one-time approval", async () => {
  let listener;
  const ctx = { on: (event, callback) => { assert.equal(event, "tools/pre-execute"); listener = callback; return () => {}; } };
  const wallet = { prepareSend: async () => ({
    amountSol: "0.1",
    recipient: "RecipientAddress",
    network: "devnet",
    feeSol: "0.000005",
    totalSol: "0.100005",
  }) };
  requireTransferApproval(ctx, wallet);
  const decision = await listener({
    name: WALLET_SEND_TOOL,
    arguments: { recipient: "RecipientAddress", amountSol: "0.1" },
  }, async () => ({ kind: "allow" }));
  assert.equal(decision.kind, "ask");
  assert.match(decision.reason, /0\.1 SOL/u);
  assert.match(decision.reason, /irreversible/u);
  assert.match(decision.reason, /Simulation passed/u);
  assert.deepEqual(await listener({ name: "solana_wallet_balance", arguments: {} }, async () => ({ kind: "allow" })), { kind: "allow" });
});

test("client never stores or sends a recovery phrase to an agent tool", async () => {
  const [client, tools] = await Promise.all([
    readFile(new URL("../lib/client.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/tools.js", import.meta.url), "utf8"),
  ]);
  assert.match(client, /RiskConfirmation/u);
  assert.match(client, /data-dsh-plugin-icon/u);
  assert.doesNotMatch(client, /localStorage|sessionStorage/u);
  assert.doesNotMatch(tools, /\bmnemonic\b/iu);
});
