import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Decoder } from "@solana/kit";
import { formatSol, parseSolAmount, SolanaWalletService } from "../lib/solana.js";
import { signerFromMnemonic } from "../lib/vault.js";

const KNOWN_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const RECIPIENT = "Vote111111111111111111111111111111111111111";

test("parses SOL without floating point rounding", () => {
  assert.equal(parseSolAmount("0.000000001"), 1n);
  assert.equal(parseSolAmount("1.25"), 1_250_000_000n);
  assert.equal(formatSol(1_250_000_000n), "1.25");
  assert.throws(() => parseSolAmount("1.0000000001"), /9 decimal/u);
  assert.throws(() => parseSolAmount("1e-3"), /positive SOL/u);
});

test("builds, signs, broadcasts, and confirms one native SOL transfer", async () => {
  const signer = await signerFromMnemonic(KNOWN_MNEMONIC);
  const vault = { signer: () => signer, status: async () => ({ configured: true, address: String(signer.address) }) };
  let submittedWire;
  const rpc = {
    getBalance: () => ({ send: async () => ({ value: 2_000_000_000n }) }),
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100n } }) }),
    getFeeForMessage: () => ({ send: async () => ({ value: 5_000n }) }),
    simulateTransaction: () => ({ send: async () => ({ value: { err: null } }) }),
    sendTransaction: (wire) => ({ send: async () => {
      submittedWire = wire;
      return getBase58Decoder().decode(Buffer.from(wire, "base64").subarray(1, 65));
    } }),
    getSignatureStatuses: () => ({ send: async () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }) }),
  };
  const service = new SolanaWalletService(vault, { getNetwork: () => "devnet", createRpc: () => rpc });
  const result = await service.send(RECIPIENT, "0.25", { signal: new AbortController().signal });
  assert.ok(submittedWire.length > 100);
  assert.equal(result.amountLamports, "250000000");
  assert.equal(result.feeLamports, "5000");
  assert.equal(result.recipient, RECIPIENT);
  assert.equal(result.confirmationStatus, "confirmed");
  assert.match(result.explorerUrl, /cluster=devnet/u);
});

test("prepares an unsigned fee and simulation preview before approval", async () => {
  const signer = await signerFromMnemonic(KNOWN_MNEMONIC);
  const vault = { signer: () => signer };
  const rpc = {
    getBalance: () => ({ send: async () => ({ value: 1_000_000_000n }) }),
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100n } }) }),
    getFeeForMessage: () => ({ send: async () => ({ value: 5_000n }) }),
    simulateTransaction: () => ({ send: async () => ({ value: { err: null } }) }),
  };
  const service = new SolanaWalletService(vault, { getNetwork: () => "devnet", createRpc: () => rpc });
  const preview = await service.prepareSend(RECIPIENT, "0.1", { signal: new AbortController().signal });
  assert.deepEqual({ feeSol: preview.feeSol, totalSol: preview.totalSol, simulation: preview.simulation }, {
    feeSol: "0.000005",
    totalSol: "0.100005",
    simulation: "passed",
  });
});

test("returns public balance and transaction history without requiring unlock", async () => {
  const walletAddress = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";
  const rpc = {
    getBalance: () => ({ send: async () => ({ value: 1_500_000_000n }) }),
    getSignaturesForAddress: () => ({ send: async () => [{
      signature: "3".repeat(88), err: null, confirmationStatus: "finalized", blockTime: 123n, memo: null,
    }] }),
    getTransaction: () => ({ send: async () => ({
      transaction: { message: { accountKeys: [{ pubkey: walletAddress }] } },
      meta: { preBalances: [2_000_000_000n], postBalances: [1_499_995_000n] },
    }) }),
  };
  const vault = { status: async () => ({ configured: true, address: walletAddress }) };
  const service = new SolanaWalletService(vault, { getNetwork: () => "devnet", createRpc: () => rpc });
  assert.equal((await service.balance()).balanceSol, "1.5");
  const history = await service.transactions({ limit: 1 });
  assert.equal(history.transactions[0].direction, "sent");
  assert.equal(history.transactions[0].changeSol, "0.500005");
});
