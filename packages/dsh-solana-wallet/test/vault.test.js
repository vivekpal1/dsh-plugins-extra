import assert from "node:assert/strict";
import test from "node:test";
import { WalletVault, decryptMnemonic, encryptMnemonic, signerFromMnemonic } from "../lib/vault.js";

const KNOWN_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

class MemoryCredentials {
  values = new Map();
  async resolve(ref) { return this.values.has(ref) ? { value: this.values.get(ref) } : undefined; }
  async set(ref, value) { this.values.set(ref, value); }
  async unset(ref) { this.values.delete(ref); }
}

test("derives the standard first Solana BIP44 account", async () => {
  const signer = await signerFromMnemonic(KNOWN_MNEMONIC);
  assert.equal(String(signer.address), "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
});

test("encrypts the recovery phrase and rejects the wrong password", async () => {
  const encrypted = await encryptMnemonic(KNOWN_MNEMONIC, "correct horse battery staple");
  assert.equal(JSON.stringify(encrypted).includes("abandon"), false);
  assert.equal(await decryptMnemonic(encrypted, "correct horse battery staple"), KNOWN_MNEMONIC);
  await assert.rejects(() => decryptMnemonic(encrypted, "incorrect password value"), /incorrect|damaged/u);
});

test("creates, locks, unlocks, reveals, and removes an encrypted wallet", async () => {
  const credentials = new MemoryCredentials();
  const vault = new WalletVault(credentials, "TEST_WALLET", { unlockMs: 50 });
  const created = await vault.create("correct horse battery staple");
  assert.equal(created.mnemonic.split(" ").length, 24);
  assert.equal(JSON.stringify([...credentials.values.values()]).includes(created.mnemonic), false);
  assert.equal((await vault.status()).unlocked, true);
  vault.lock();
  assert.equal((await vault.status()).unlocked, false);
  await assert.rejects(() => vault.unlock("incorrect password value"), /incorrect|damaged/u);
  await vault.unlock("correct horse battery staple");
  assert.equal((await vault.status()).unlocked, true);
  assert.equal((await vault.reveal("correct horse battery staple")).mnemonic, created.mnemonic);
  await vault.delete("correct horse battery staple");
  assert.deepEqual(await vault.status(), { configured: false, unlocked: false, address: undefined, derivationPath: undefined });
});

test("imports a known phrase without exposing it in status", async () => {
  const credentials = new MemoryCredentials();
  const vault = new WalletVault(credentials, "TEST_WALLET");
  const result = await vault.import(KNOWN_MNEMONIC, "correct horse battery staple");
  assert.equal(result.address, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
  assert.equal("mnemonic" in await vault.status(), false);
  vault.dispose();
});
