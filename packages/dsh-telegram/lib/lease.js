import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_STALE_MS = 45_000;
const DEFAULT_HEARTBEAT_MS = 10_000;

export class PollingLeaseError extends Error {
  constructor(message = "Telegram polling is already active in another DSH process") {
    super(message);
    this.name = "PollingLeaseError";
  }
}

function safeBotId(botId) {
  const value = String(botId ?? "");
  if (!/^\d{1,24}$/u.test(value)) throw new Error("Telegram bot ID is invalid");
  return value;
}

async function readOwner(lockPath) {
  try {
    return JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"));
  } catch {
    return undefined;
  }
}

async function writeOwner(lockPath, owner) {
  const temporary = join(lockPath, `owner-${owner.nonce}.tmp`);
  await writeFile(temporary, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
  await rename(temporary, join(lockPath, "owner.json"));
}

export class PollingLease {
  static async acquire(botId, options = {}) {
    const root = options.root ?? join(process.env.DSH_HOME || join(homedir(), ".dsh"), "locks");
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const now = options.now ?? Date.now;
    const lockPath = join(root, `telegram-bot-${safeBotId(botId)}.lock`);
    await mkdir(root, { recursive: true, mode: 0o700 });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        const lease = new PollingLease(lockPath, { staleMs, heartbeatMs, now });
        await lease.initialize();
        return lease;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const owner = await readOwner(lockPath);
        let modifiedAt = 0;
        try { modifiedAt = (await stat(lockPath)).mtimeMs; } catch {}
        const heartbeatAt = Number(owner?.heartbeatAt) || modifiedAt;
        if (now() - heartbeatAt <= staleMs) throw new PollingLeaseError();
        await rm(lockPath, { recursive: true, force: true });
      }
    }
    throw new PollingLeaseError();
  }

  constructor(lockPath, options) {
    this.lockPath = lockPath;
    this.heartbeatMs = options.heartbeatMs;
    this.now = options.now;
    this.nonce = randomUUID();
    this.timer = undefined;
    this.released = false;
  }

  async initialize() {
    await this.#heartbeat();
    this.timer = setInterval(() => {
      void this.#heartbeat().catch(() => {});
    }, this.heartbeatMs);
    this.timer.unref?.();
  }

  async #heartbeat() {
    if (this.released) return;
    await writeOwner(this.lockPath, {
      nonce: this.nonce,
      pid: process.pid,
      heartbeatAt: this.now(),
    });
  }

  async release() {
    if (this.released) return;
    this.released = true;
    clearInterval(this.timer);
    const owner = await readOwner(this.lockPath);
    if (owner?.nonce === this.nonce) await rm(this.lockPath, { recursive: true, force: true });
  }
}
