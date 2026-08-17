# DSH Solana Wallet

An encrypted, self-custodial Solana wallet for DeepSeek Harness. It provides a settings page for wallet creation, recovery, receiving, balances, transaction history, locking, and approved native SOL transfers, plus session tools for the same public operations.

The recovery phrase is encrypted with AES-256-GCM using a password-derived scrypt key before it is written to DSH's credential store. The phrase is never exposed to an agent or tool result. Signing material exists only in host memory while the wallet is unlocked, and every session-initiated transfer uses DSH's native one-time approval prompt.

New wallets start on Solana devnet. Mainnet must be selected explicitly in Settings. This first release supports native SOL; SPL token support is planned separately.

This software is experimental and unaudited. Back up the recovery phrase offline and begin with devnet or very small balances.
