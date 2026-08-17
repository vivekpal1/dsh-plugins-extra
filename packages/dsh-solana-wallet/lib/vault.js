import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";
import { promisify } from "node:util";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic, wordlists } from "bip39";
import slip10 from "micro-key-producer/slip10.js";

export const DERIVATION_PATH = "m/44'/501'/0'/0'";
export const VAULT_VERSION = 1;
export const DEFAULT_UNLOCK_MS = 5 * 60 * 1000;
const scrypt = promisify(scryptCallback);
const KDF = Object.freeze({ name: "scrypt", N: 32768, r: 8, p: 1, keyLength: 32 });
const MIN_PASSWORD_LENGTH = 12;

function assertPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Wallet password must contain at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

function normalizeMnemonic(mnemonic) {
  if (typeof mnemonic !== "string") throw new Error("Recovery phrase is required");
  const value = mnemonic.trim().toLowerCase().replace(/\s+/gu, " ");
  if (!validateMnemonic(value, wordlists.english)) throw new Error("Recovery phrase is not valid BIP39 English");
  return value;
}

async function deriveEncryptionKey(password, salt, kdf = KDF) {
  assertPassword(password);
  if (kdf?.name !== "scrypt" || kdf.N !== KDF.N || kdf.r !== KDF.r || kdf.p !== KDF.p || kdf.keyLength !== KDF.keyLength) {
    throw new Error("Wallet uses an unsupported encryption profile");
  }
  return scrypt(password, salt, kdf.keyLength, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 64 * 1024 * 1024,
  });
}

export async function signerFromMnemonic(input) {
  const mnemonic = normalizeMnemonic(input);
  const seed = mnemonicToSeedSync(mnemonic);
  let privateKey;
  try {
    const root = slip10.fromMasterSeed(seed);
    const child = root.derive(DERIVATION_PATH);
    privateKey = new Uint8Array(child.privateKey);
    return await createKeyPairSignerFromPrivateKeyBytes(privateKey);
  } finally {
    seed.fill(0);
    privateKey?.fill(0);
  }
}

export async function encryptMnemonic(input, password) {
  const mnemonic = normalizeMnemonic(input);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveEncryptionKey(password, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(mnemonic, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      algorithm: "aes-256-gcm",
      kdf: KDF,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    key.fill(0);
  }
}

export async function decryptMnemonic(encrypted, password) {
  try {
    if (encrypted?.algorithm !== "aes-256-gcm") throw new Error("Unsupported wallet encryption");
    const salt = Buffer.from(encrypted.salt, "base64");
    const iv = Buffer.from(encrypted.iv, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Malformed wallet encryption");
    const key = await deriveEncryptionKey(password, salt, encrypted.kdf);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return normalizeMnemonic(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    } finally {
      key.fill(0);
    }
  } catch (error) {
    const publicMessages = new Set([
      `Wallet password must contain at least ${MIN_PASSWORD_LENGTH} characters`,
      "Unsupported wallet encryption",
      "Malformed wallet encryption",
      "Wallet uses an unsupported encryption profile",
    ]);
    if (error instanceof Error && publicMessages.has(error.message)) throw error;
    throw new Error("Wallet password is incorrect or the encrypted wallet is damaged");
  }
}

function parseStored(value) {
  try {
    const record = JSON.parse(value);
    if (record?.version !== VAULT_VERSION || typeof record.publicKey !== "string" || record.publicKey.length < 32 || typeof record.encrypted !== "object") {
      throw new Error("Malformed encrypted wallet");
    }
    return record;
  } catch (error) {
    if (error instanceof Error && error.message === "Malformed encrypted wallet") throw error;
    throw new Error("Malformed encrypted wallet", { cause: error });
  }
}

export class WalletVault {
  #signer;
  #timer;

  constructor(credentials, ref, options = {}) {
    if (!credentials || typeof credentials.resolve !== "function" || typeof credentials.set !== "function") {
      throw new Error("Solana wallet requires the DSH credentials service");
    }
    this.credentials = credentials;
    this.ref = ref;
    this.unlockMs = options.unlockMs ?? DEFAULT_UNLOCK_MS;
  }

  async #stored() {
    const hit = await this.credentials.resolve(this.ref);
    if (hit?.value === undefined || hit.value === "") return undefined;
    return parseStored(hit.value);
  }

  #touch() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.lock(), this.unlockMs);
    this.#timer.unref?.();
  }

  async status() {
    const stored = await this.#stored();
    return {
      configured: stored !== undefined,
      unlocked: stored !== undefined && this.#signer !== undefined,
      address: stored?.publicKey,
      derivationPath: stored === undefined ? undefined : DERIVATION_PATH,
    };
  }

  async #saveMnemonic(mnemonic, password) {
    const signer = await signerFromMnemonic(mnemonic);
    const encrypted = await encryptMnemonic(mnemonic, password);
    const record = {
      version: VAULT_VERSION,
      publicKey: String(signer.address),
      derivationPath: DERIVATION_PATH,
      createdAt: new Date().toISOString(),
      encrypted,
    };
    await this.credentials.set(this.ref, JSON.stringify(record));
    this.#signer = signer;
    this.#touch();
    return record;
  }

  async create(password) {
    if (await this.#stored()) throw new Error("A Solana wallet already exists");
    assertPassword(password);
    const mnemonic = generateMnemonic(256, randomBytes, wordlists.english);
    const record = await this.#saveMnemonic(mnemonic, password);
    return { mnemonic, address: record.publicKey, derivationPath: DERIVATION_PATH };
  }

  async import(mnemonic, password) {
    if (await this.#stored()) throw new Error("A Solana wallet already exists");
    assertPassword(password);
    const normalized = normalizeMnemonic(mnemonic);
    const record = await this.#saveMnemonic(normalized, password);
    return { address: record.publicKey, derivationPath: DERIVATION_PATH };
  }

  async unlock(password) {
    const stored = await this.#stored();
    if (!stored) throw new Error("Create or import a wallet first");
    const mnemonic = await decryptMnemonic(stored.encrypted, password);
    const signer = await signerFromMnemonic(mnemonic);
    if (String(signer.address) !== stored.publicKey) throw new Error("Encrypted wallet does not match its public address");
    this.#signer = signer;
    this.#touch();
    return { address: stored.publicKey };
  }

  async reveal(password) {
    const stored = await this.#stored();
    if (!stored) throw new Error("Create or import a wallet first");
    return { mnemonic: await decryptMnemonic(stored.encrypted, password), address: stored.publicKey };
  }

  lock() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#signer = undefined;
  }

  signer() {
    if (!this.#signer) throw new Error("Unlock the wallet in Settings before signing");
    this.#touch();
    return this.#signer;
  }

  async delete(password) {
    await this.reveal(password);
    this.lock();
    await this.credentials.unset(this.ref);
  }

  dispose() {
    this.lock();
  }
}
