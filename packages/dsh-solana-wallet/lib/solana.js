import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  compileTransactionMessage,
  createSolanaRpc,
  createTransactionMessage,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageEncoder,
  getSignatureFromTransaction,
  lamports,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const NETWORKS = Object.freeze({
  devnet: Object.freeze({ id: "devnet", label: "Devnet", rpcUrl: "https://api.devnet.solana.com" }),
  "mainnet-beta": Object.freeze({ id: "mainnet-beta", label: "Mainnet Beta", rpcUrl: "https://api.mainnet-beta.solana.com" }),
});
const AMOUNT = /^(?:0|[1-9]\d*)(?:\.(\d{1,9}))?$/u;

export function parseSolAmount(value) {
  if (typeof value !== "string") throw new Error("SOL amount must be a decimal string");
  const normalized = value.trim();
  const match = AMOUNT.exec(normalized);
  if (!match) throw new Error("Enter a positive SOL amount with no more than 9 decimal places");
  const [whole, fraction = ""] = normalized.split(".");
  const result = BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, "0") || "0");
  if (result <= 0n) throw new Error("SOL amount must be greater than zero");
  if (result > 1_000_000_000n * LAMPORTS_PER_SOL) throw new Error("SOL amount is outside the supported range");
  return result;
}

export function formatSol(value) {
  const lamportValue = BigInt(value);
  const whole = lamportValue / LAMPORTS_PER_SOL;
  const fraction = (lamportValue % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function networkDefinition(network) {
  const definition = NETWORKS[network];
  if (!definition) throw new Error("Unsupported Solana network");
  return definition;
}

export function explorerUrl(network, kind, value) {
  const base = `https://explorer.solana.com/${kind}/${encodeURIComponent(value)}`;
  return network === "devnet" ? `${base}?cluster=devnet` : base;
}

const numberOrNull = (value) => value === null || value === undefined ? null : Number(value);
const stringOrNull = (value) => typeof value === "string" ? value : null;

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class SolanaWalletService {
  constructor(vault, options) {
    this.vault = vault;
    this.getNetwork = options.getNetwork;
    this.createRpc = options.createRpc ?? createSolanaRpc;
  }

  #client() {
    const network = this.getNetwork();
    const definition = networkDefinition(network);
    return { network, rpc: this.createRpc(definition.rpcUrl) };
  }

  explorerAddress(publicKey) {
    const network = this.getNetwork();
    networkDefinition(network);
    return explorerUrl(network, "address", publicKey);
  }

  async balance(options = {}) {
    const status = await this.vault.status();
    if (!status.configured) throw new Error("Create or import a wallet first");
    const { network, rpc } = this.#client();
    const response = await rpc.getBalance(address(status.address), { commitment: "confirmed" }).send({ abortSignal: options.signal });
    const balanceLamports = BigInt(response.value);
    return {
      address: status.address,
      network,
      balanceLamports: balanceLamports.toString(),
      balanceSol: formatSol(balanceLamports),
      explorerUrl: explorerUrl(network, "address", status.address),
    };
  }

  async transactions(options = {}) {
    const status = await this.vault.status();
    if (!status.configured) throw new Error("Create or import a wallet first");
    const requestedLimit = Number(options.limit ?? 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 10) : 10;
    const { network, rpc } = this.#client();
    const publicKey = address(status.address);
    const signatures = await rpc.getSignaturesForAddress(publicKey, { commitment: "confirmed", limit }).send({ abortSignal: options.signal });
    const rows = await Promise.all(signatures.map(async (entry) => {
      let direction = "unknown";
      let changeLamports = null;
      try {
        const transaction = await rpc.getTransaction(entry.signature, {
          commitment: "confirmed",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        }).send({ abortSignal: options.signal });
        const keys = transaction?.transaction?.message?.accountKeys?.map((item) => typeof item === "string" ? item : String(item.pubkey)) ?? [];
        const index = keys.indexOf(status.address);
        const pre = index < 0 ? undefined : transaction?.meta?.preBalances?.[index];
        const post = index < 0 ? undefined : transaction?.meta?.postBalances?.[index];
        if (pre !== undefined && post !== undefined) {
          const delta = BigInt(post) - BigInt(pre);
          direction = delta > 0n ? "received" : delta < 0n ? "sent" : "unchanged";
          changeLamports = delta.toString();
        }
      } catch {
        // Signature history remains useful when a public RPC prunes transaction details.
      }
      return {
        signature: String(entry.signature),
        status: entry.err === null ? (entry.confirmationStatus ?? "confirmed") : "failed",
        direction,
        changeLamports,
        changeSol: changeLamports === null ? null : formatSol(BigInt(changeLamports) < 0n ? -BigInt(changeLamports) : BigInt(changeLamports)),
        blockTime: numberOrNull(entry.blockTime),
        memo: stringOrNull(entry.memo),
        explorerUrl: explorerUrl(network, "tx", String(entry.signature)),
      };
    }));
    return { address: status.address, network, transactions: rows };
  }

  async #confirm(rpc, signature, lastValidBlockHeight, signal) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      signal?.throwIfAborted();
      const response = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send({ abortSignal: signal });
      const status = response.value[0];
      if (status?.err) throw new Error("Solana transaction failed during confirmation");
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return status.confirmationStatus;
      if (attempt % 5 === 4) {
        const blockHeight = await rpc.getBlockHeight({ commitment: "confirmed" }).send({ abortSignal: signal });
        if (BigInt(blockHeight) > BigInt(lastValidBlockHeight)) throw new Error("Solana transaction expired before confirmation");
      }
      await delay(500, signal);
    }
    throw new Error("Solana transaction confirmation timed out");
  }

  async #prepareTransfer(recipient, amount, options = {}) {
    const signer = this.vault.signer();
    let destination;
    try {
      destination = address(recipient?.trim());
    } catch {
      throw new Error("Recipient is not a valid Solana address");
    }
    if (String(destination) === String(signer.address)) throw new Error("Recipient must be different from this wallet");
    const amountLamports = parseSolAmount(amount);
    const { network, rpc } = this.#client();
    const current = await rpc.getBalance(signer.address, { commitment: "confirmed" }).send({ abortSignal: options.signal });
    const latest = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send({ abortSignal: options.signal });
    const instruction = getTransferSolInstruction({
      source: signer,
      destination,
      amount: lamports(amountLamports),
    });
    let message = createTransactionMessage({ version: 0 });
    message = setTransactionMessageFeePayerSigner(signer, message);
    message = setTransactionMessageLifetimeUsingBlockhash(latest.value, message);
    message = appendTransactionMessageInstruction(instruction, message);
    const compiledMessage = compileTransactionMessage(message);
    const messageBytes = getCompiledTransactionMessageEncoder().encode(compiledMessage);
    const encodedMessage = getBase64Decoder().decode(messageBytes);
    const feeResponse = await rpc.getFeeForMessage(encodedMessage, { commitment: "confirmed" }).send({ abortSignal: options.signal });
    if (feeResponse.value === null) throw new Error("Solana could not estimate the transaction fee");
    const feeLamports = BigInt(feeResponse.value);
    if (BigInt(current.value) < amountLamports + feeLamports) throw new Error("Wallet balance must cover the amount and transaction fee");
    const unsignedWire = getBase64EncodedWireTransaction(compileTransaction(message));
    const simulation = await rpc.simulateTransaction(unsignedWire, {
      commitment: "confirmed",
      encoding: "base64",
      sigVerify: false,
    }).send({ abortSignal: options.signal });
    if (simulation.value.err !== null) throw new Error("Solana transaction simulation failed");
    return { signer, destination, amountLamports, feeLamports, network, rpc, latest, message };
  }

  async prepareSend(recipient, amount, options = {}) {
    const prepared = await this.#prepareTransfer(recipient, amount, options);
    return {
      network: prepared.network,
      from: String(prepared.signer.address),
      recipient: String(prepared.destination),
      amountLamports: prepared.amountLamports.toString(),
      amountSol: formatSol(prepared.amountLamports),
      feeLamports: prepared.feeLamports.toString(),
      feeSol: formatSol(prepared.feeLamports),
      totalSol: formatSol(prepared.amountLamports + prepared.feeLamports),
      simulation: "passed",
    };
  }

  async send(recipient, amount, options = {}) {
    const prepared = await this.#prepareTransfer(recipient, amount, options);
    const { signer, destination, amountLamports, feeLamports, network, rpc, latest, message } = prepared;
    const signed = await signTransactionMessageWithSigners(message);
    const expectedSignature = getSignatureFromTransaction(signed);
    const wire = getBase64EncodedWireTransaction(signed);
    const signature = await rpc.sendTransaction(wire, {
      encoding: "base64",
      maxRetries: 3n,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    }).send({ abortSignal: options.signal });
    if (String(signature) !== String(expectedSignature)) throw new Error("Solana RPC returned an unexpected transaction signature");
    const confirmationStatus = await this.#confirm(rpc, signature, latest.value.lastValidBlockHeight, options.signal);
    return {
      signature: String(signature),
      network,
      from: String(signer.address),
      recipient: String(destination),
      amountLamports: amountLamports.toString(),
      amountSol: formatSol(amountLamports),
      feeLamports: feeLamports.toString(),
      feeSol: formatSol(feeLamports),
      confirmationStatus,
      explorerUrl: explorerUrl(network, "tx", String(signature)),
    };
  }
}
