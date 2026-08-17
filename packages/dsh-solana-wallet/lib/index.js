import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { networkDefinition, SolanaWalletService } from "./solana.js";
import { createWalletTools, requireTransferApproval } from "./tools.js";
import { WalletVault } from "./vault.js";

export const name = "solana-wallet";
export const inject = ["credentials", "connection", "settings", "tools"];
export const CHANNEL = "/solana-wallet";
export const CREDENTIAL_REF = credentialRef("DSH_SOLANA_WALLET_V1");
export const SETTINGS_NAMESPACE = "solana-wallet";

const SAFE_ERROR = /^(?:A Solana wallet already exists|Create or import a wallet first|Create or import a wallet in Settings first|Wallet password must contain at least 12 characters|Recovery phrase is required|Recovery phrase is not valid BIP39 English|Wallet password is incorrect or the encrypted wallet is damaged|Encrypted wallet does not match its public address|Unlock the wallet in Settings before signing|Recipient is not a valid Solana address|Recipient must be different from this wallet|Enter a positive SOL amount with no more than 9 decimal places|SOL amount must be greater than zero|SOL amount is outside the supported range|Wallet balance must cover the amount and transaction fee|Solana could not estimate the transaction fee|Solana transaction simulation failed|Unsupported Solana network|Mainnet selection requires explicit acknowledgement|Solana transaction failed during confirmation|Solana transaction expired before confirmation|Solana transaction confirmation timed out)$/u;

function publicError(error) {
  const message = error instanceof Error && SAFE_ERROR.test(error.message)
    ? error.message
    : "Solana wallet request failed";
  return { ok: false, error: { code: "solana_wallet_failed", message, details: { issues: [] } } };
}

export function createWalletRpcHandler({ vault, wallet, settings }) {
  return async (endpoint, payload, signal) => {
    try {
      signal.throwIfAborted();
      let value;
      if (endpoint === "status") {
        value = { ...await vault.status(), network: settings.get().network, autoLockMinutes: 5 };
      } else if (endpoint === "create") {
        value = await vault.create(payload?.password);
      } else if (endpoint === "import") {
        value = await vault.import(payload?.mnemonic, payload?.password);
      } else if (endpoint === "unlock") {
        value = await vault.unlock(payload?.password);
      } else if (endpoint === "lock") {
        vault.lock();
        value = { locked: true };
      } else if (endpoint === "reveal") {
        value = await vault.reveal(payload?.password);
      } else if (endpoint === "delete") {
        await vault.delete(payload?.password);
        value = { deleted: true };
      } else if (endpoint === "set-network") {
        const network = payload?.network;
        networkDefinition(network);
        if (network === "mainnet-beta" && payload?.acknowledgeMainnet !== true) {
          throw new Error("Mainnet selection requires explicit acknowledgement");
        }
        await settings.update({ network });
        value = { network };
      } else if (endpoint === "balance") {
        value = await wallet.balance({ signal });
      } else if (endpoint === "transactions") {
        value = await wallet.transactions({ limit: payload?.limit, signal });
      } else if (endpoint === "prepare-send") {
        value = await wallet.prepareSend(payload?.recipient, payload?.amountSol, { signal });
      } else if (endpoint === "send") {
        value = await wallet.send(payload?.recipient, payload?.amountSol, { signal });
      } else {
        return { ok: false, error: { code: "not_found", message: "Unknown Solana wallet endpoint", details: { issues: [] } } };
      }
      signal.throwIfAborted();
      return { ok: true, value };
    } catch (error) {
      if (signal.aborted) throw error;
      return publicError(error);
    }
  };
}

export function apply(ctx) {
  const settings = ctx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), z.object({
    network: z.union(["devnet", "mainnet-beta"]).default("devnet"),
  }));
  const vault = new WalletVault(ctx.credentials, CREDENTIAL_REF);
  const getNetwork = () => settings.get().network;
  const wallet = new SolanaWalletService(vault, { getNetwork });

  ctx.effect(() => () => vault.dispose(), "solana-wallet: clear signing material");
  for (const tool of createWalletTools({ vault, wallet, getNetwork })) ctx.tools.register(tool);
  ctx.effect(() => requireTransferApproval(ctx, wallet), "solana-wallet: transfer approval");
  ctx.effect(
    () => ctx.connection.rpc.handle(CHANNEL, createWalletRpcHandler({ vault, wallet, settings }), { authority: "loopback" }),
    "solana-wallet: loopback RPC",
  );
}

export { SolanaWalletService, explorerUrl, formatSol, parseSolAmount } from "./solana.js";
export { createWalletTools, requireTransferApproval } from "./tools.js";
export { WalletVault, decryptMnemonic, encryptMnemonic, signerFromMnemonic } from "./vault.js";
