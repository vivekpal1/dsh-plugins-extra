import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createWalletRpcHandler, enabledNetwork } from "../lib/index.js";
import { createWalletTools, requireTransferApproval, WALLET_SEND_TOOL } from "../lib/tools.js";

test("all four wallet tools compile through DSH's value-schema DSL", async () => {
  const tools = createWalletTools({
    vault: { status: async () => ({ configured: true, unlocked: false, address: "WalletAddress" }) },
    wallet: {
      explorerAddress: () => "https://explorer.solana.com/address/WalletAddress",
      balance: async () => ({}),
      transactions: async () => ({}),
      send: async () => ({}),
    },
    getNetwork: () => "devnet",
  });
  assert.equal(tools.length, 4);
  const sendTool = tools.find((tool) => tool.name === WALLET_SEND_TOOL);
  assert.deepEqual(sendTool.parameters.properties.network.enum, ["devnet", "mainnet-beta"]);
  assert.equal(sendTool.parameters.required.includes("network"), true);
  const addressTool = tools.find((tool) => tool.name === "solana_wallet_address");
  const address = await addressTool.execute({}, { signal: new AbortController().signal });
  assert.equal(address.unlocked, false);
  assert.match(addressTool.output.render({}, address)[0].text, /Settings > Wallets/u);
});

test("mainnet is effective only when its acknowledgement is persisted", () => {
  assert.equal(enabledNetwork({ get: () => ({ network: "devnet", mainnetEnabled: false }) }), "devnet");
  assert.equal(enabledNetwork({ get: () => ({ network: "mainnet-beta", mainnetEnabled: false }) }), "devnet");
  assert.equal(enabledNetwork({ get: () => ({ network: "mainnet-beta", mainnetEnabled: true }) }), "mainnet-beta");
});

test("loopback RPC persists mainnet acknowledgement and binds sends to the previewed network", async () => {
  let stored = { network: "devnet", mainnetEnabled: false };
  let sentOptions;
  const settings = {
    get: () => stored,
    update: async (next) => { stored = next; },
  };
  const wallet = {
    send: async (_recipient, _amount, options) => { sentOptions = options; return { signature: "signature" }; },
  };
  const vault = { status: async () => ({ configured: true, unlocked: true, address: "WalletAddress" }) };
  const handler = createWalletRpcHandler({ vault, wallet, settings });
  const signal = new AbortController().signal;
  const rejected = await handler("set-network", { network: "mainnet-beta" }, signal);
  assert.equal(rejected.ok, false);
  assert.equal(enabledNetwork(settings), "devnet");
  const selected = await handler("set-network", { network: "mainnet-beta", acknowledgeMainnet: true }, signal);
  assert.deepEqual(selected, { ok: true, value: { network: "mainnet-beta" } });
  assert.equal(enabledNetwork(settings), "mainnet-beta");
  await handler("send", { recipient: "RecipientAddress", amountSol: "0.1", expectedNetwork: "mainnet-beta" }, signal);
  assert.equal(sentOptions.expectedNetwork, "mainnet-beta");
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
    arguments: { network: "devnet", recipient: "RecipientAddress", amountSol: "0.1" },
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
  assert.match(client, /expectedNetwork: pendingSend\.preview\.network/u);
});
