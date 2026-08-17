import { defineTool } from "@deepseek-ai/dsh-tools";

export const WALLET_ADDRESS_TOOL = "solana_wallet_address";
export const WALLET_BALANCE_TOOL = "solana_wallet_balance";
export const WALLET_TRANSACTIONS_TOOL = "solana_wallet_transactions";
export const WALLET_SEND_TOOL = "solana_wallet_send";

const text = (value) => [{ type: "text", text: value }];
const nullableString = { oneOf: [{ type: "string" }, { type: "null" }] };
const required = (schema) => ({ ...schema, required: true });

const addressSchema = {
  type: "object",
  properties: {
    address: required({ type: "string" }),
    unlocked: required({ type: "boolean" }),
    network: required({ type: "string" }),
    explorerUrl: required({ type: "string" }),
  },
  additionalProperties: false,
};

const balanceSchema = {
  type: "object",
  properties: {
    address: required({ type: "string" }),
    unlocked: required({ type: "boolean" }),
    network: required({ type: "string" }),
    balanceLamports: required({ type: "string" }),
    balanceSol: required({ type: "string" }),
    explorerUrl: required({ type: "string" }),
  },
  additionalProperties: false,
};

const transactionSchema = {
  type: "object",
  properties: {
    signature: required({ type: "string" }),
    status: required({ type: "string" }),
    direction: required({ type: "string" }),
    changeLamports: required(nullableString),
    changeSol: required(nullableString),
    blockTime: required({ oneOf: [{ type: "number" }, { type: "null" }] }),
    memo: required(nullableString),
    explorerUrl: required({ type: "string" }),
  },
  additionalProperties: false,
};

const transactionsSchema = {
  type: "object",
  properties: {
    address: required({ type: "string" }),
    network: required({ type: "string" }),
    transactions: required({ type: "array", items: transactionSchema }),
  },
  additionalProperties: false,
};

const sendSchema = {
  type: "object",
  properties: {
    signature: required({ type: "string" }),
    network: required({ type: "string" }),
    from: required({ type: "string" }),
    recipient: required({ type: "string" }),
    amountLamports: required({ type: "string" }),
    amountSol: required({ type: "string" }),
    feeLamports: required({ type: "string" }),
    feeSol: required({ type: "string" }),
    confirmationStatus: required({ type: "string" }),
    explorerUrl: required({ type: "string" }),
  },
  additionalProperties: false,
};

export function createWalletTools({ vault, wallet, getNetwork }) {
  const addressTool = defineTool({
    name: WALLET_ADDRESS_TOOL,
    description: "Show the configured Solana wallet's public receive address and network. This never reveals private keys or the recovery phrase.",
    parameters: {},
    output: {
      schema: addressSchema,
      render: (_args, value) => text(`Solana ${value.network} receive address: ${value.address}\nWallet: ${value.unlocked ? "unlocked for signing" : "locked; unlock it in Settings > Wallets before sending"}\nExplorer: ${value.explorerUrl}`),
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      exec.signal.throwIfAborted();
      const status = await vault.status();
      if (!status.configured) throw new Error("Create or import a wallet in Settings first");
      const network = getNetwork();
      return {
        address: status.address,
        unlocked: status.unlocked === true,
        network,
        explorerUrl: wallet.explorerAddress(status.address),
      };
    },
  });

  const balanceTool = defineTool({
    name: WALLET_BALANCE_TOOL,
    description: "Read the native SOL balance for the configured DSH Solana wallet.",
    parameters: {},
    output: {
      schema: balanceSchema,
      render: (_args, value) => text(`${value.balanceSol} SOL on ${value.network}\nAddress: ${value.address}\nWallet: ${value.unlocked ? "unlocked for signing" : "locked; unlock it in Settings > Wallets before sending"}`),
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      return wallet.balance({ signal: exec.signal });
    },
  });

  const transactionsTool = defineTool({
    name: WALLET_TRANSACTIONS_TOOL,
    description: "List up to 10 recent confirmed Solana transactions for the configured wallet, including public signatures and net SOL changes.",
    parameters: {
      limit: {
        type: "integer",
        description: "Number of recent transactions to return, from 1 to 10. Defaults to 10.",
      },
    },
    output: {
      schema: transactionsSchema,
      render: (_args, value) => text(value.transactions.length === 0
        ? `No recent transactions found on ${value.network}.`
        : JSON.stringify(value, null, 2)),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return wallet.transactions({ limit: args.limit, signal: exec.signal });
    },
  });

  const sendTool = defineTool({
    name: WALLET_SEND_TOOL,
    description: "Send native SOL from the configured wallet. Always ask the user before calling this tool. DSH presents a mandatory one-time approval showing the exact network, recipient, amount, and fee, and the wallet must already be unlocked in Settings.",
    parameters: {
      network: {
        type: "string",
        enum: ["devnet", "mainnet-beta"],
        required: true,
        description: "Exact Solana network confirmed by the user. Use mainnet-beta only for real SOL.",
      },
      recipient: {
        type: "string",
        required: true,
        description: "Exact base58 Solana recipient address supplied or confirmed by the user.",
      },
      amountSol: {
        type: "string",
        required: true,
        description: "Exact positive decimal SOL amount as a string, with at most 9 decimal places.",
      },
    },
    output: {
      schema: sendSchema,
      render: (_args, value) => text(`Sent ${value.amountSol} SOL to ${value.recipient} on ${value.network}. Network fee: ${value.feeSol} SOL.\nSignature: ${value.signature}\nExplorer: ${value.explorerUrl}`),
    },
    timeoutMs: 90 * 1000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return wallet.send(args.recipient, args.amountSol, {
        expectedNetwork: args.network,
        signal: exec.signal,
      });
    },
  });

  return [addressTool, balanceTool, transactionsTool, sendTool];
}

export function requireTransferApproval(ctx, wallet) {
  return ctx.on("tools/pre-execute", async (exec, next) => {
    if (exec.name !== WALLET_SEND_TOOL) return next();
    const downstream = await next();
    if (downstream.kind !== "allow") return downstream;
    const recipient = typeof exec.arguments?.recipient === "string" ? exec.arguments.recipient : "the requested recipient";
    const amount = typeof exec.arguments?.amountSol === "string" ? exec.arguments.amountSol : "the requested amount";
    let preview;
    try {
      preview = await wallet.prepareSend(recipient, amount, {
        expectedNetwork: exec.arguments?.network,
        signal: exec.signal,
      });
    } catch (error) {
      return { kind: "deny", reason: error instanceof Error ? error.message : "Could not prepare the Solana transfer" };
    }
    return {
      kind: "ask",
      reason: `Approve sending ${preview.amountSol} SOL to ${preview.recipient} on ${preview.network}. Estimated fee: ${preview.feeSol} SOL. Total: ${preview.totalSol} SOL. Simulation passed. This broadcasts an irreversible blockchain transaction.`,
    };
  });
}
