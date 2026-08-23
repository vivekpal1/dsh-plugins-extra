import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  SlidingWindowRateLimiter,
  TelegramApi,
  TelegramApiError,
  normalizeBotToken,
  parseTelegramCommand,
  sendTelegramText,
  splitTelegramText,
} from "./telegram.js";
import { PollingLease } from "./lease.js";

const PAIR_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PAIR_TTL_MS = 5 * 60 * 1000;
const MAX_UPDATE_AGE_MS = 2 * 60 * 1000;
const MAX_PROMPT_CODE_POINTS = 4000;
const MAX_PROMPT_BYTES = 8192;
const MAX_OUTPUT_CHUNKS = 8;
const SESSION_LIST_LIMIT = 8;
const MAX_STATE_ROWS = 128;

function textOf(content) {
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n").trim();
}

function safeLabel(from) {
  const candidate = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || (from?.username ? `@${from.username}` : "Telegram user");
  return String(candidate).replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 80) || "Telegram user";
}

function titleOf(summary) {
  const title = summary?.projections?.values?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return `Session ${String(summary?.sessionId ?? "").slice(0, 8)}`;
}

function shortId(sessionId) {
  return String(sessionId).slice(0, 8);
}

function displayError(error) {
  if (error instanceof DshRequestError) return error.message;
  if (error instanceof TelegramApiError) return error.message;
  return "The request could not be completed";
}

function isPrivateMessage(message) {
  return message?.chat?.type === "private" && message?.from?.is_bot !== true;
}

function updateTimestamp(update) {
  const seconds = update?.message?.date ?? update?.callback_query?.message?.date;
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("Telegram polling stopped"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Telegram polling stopped"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function pairCode() {
  const bytes = randomBytes(8);
  let value = "";
  for (const byte of bytes) value += PAIR_ALPHABET[byte % PAIR_ALPHABET.length];
  return value;
}

function pairDigest(value) {
  return createHash("sha256").update(String(value).trim().toUpperCase()).digest();
}

function equalDigest(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && timingSafeEqual(left, right);
}

export class DshRequestError extends Error {
  constructor(message, code = "request_failed") {
    super(message);
    this.name = "DshRequestError";
    this.code = code;
  }
}

export class TelegramController {
  constructor(options) {
    this.settings = options.settings;
    this.credentials = options.credentials;
    this.credentialRef = options.credentialRef;
    this.apiProxy = options.apiProxy;
    this.logger = options.logger;
    this.apiFactory = options.apiFactory ?? ((token) => new TelegramApi(token));
    this.leaseFactory = options.leaseFactory ?? ((botId) => PollingLease.acquire(botId));
    this.now = options.now ?? Date.now;
    this.pairing = undefined;
    this.bot = undefined;
    this.activeApi = undefined;
    this.pollController = undefined;
    this.pollTask = undefined;
    this.lastError = undefined;
    this.pollHealthy = false;
    this.reconcileTail = Promise.resolve();
    this.submittedRpcIds = new Map();
    this.turns = new Map();
    this.revokedGenerations = new Set();
    this.deliveryControllers = new Map();
    this.deliveryTasks = new Set();
    this.pairLimiter = new SlidingWindowRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000, now: this.now });
    this.commandLimiter = new SlidingWindowRateLimiter({ limit: 10, windowMs: 60 * 1000, now: this.now });
    this.promptLimiter = new SlidingWindowRateLimiter({ limit: 3, windowMs: 60 * 1000, now: this.now });
    this.historyLimiter = new SlidingWindowRateLimiter({ limit: 6, windowMs: 60 * 1000, now: this.now });
    this.newSessionLimiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 60 * 60 * 1000, now: this.now });
  }

  async #token() {
    return (await this.credentials.resolve(this.credentialRef))?.value;
  }

  async #bindBotIdentity(bot) {
    const botId = String(bot?.id ?? "");
    if (!/^\d{1,24}$/u.test(botId)) throw new DshRequestError("Telegram returned an invalid bot identity");
    const config = this.settings.get();
    if (config.botId === botId) return;
    for (const principal of config.principals) this.#markRevoked(principal.generation);
    this.pairing = undefined;
    this.submittedRpcIds.clear();
    this.turns.clear();
    await this.settings.update({ botId, principals: [], bindings: [], ownedSessions: [], lastUpdateId: 0 });
  }

  async status() {
    const credential = await this.credentials.describe(this.credentialRef);
    const config = this.settings.get();
    return {
      tokenConfigured: credential.configured,
      tokenWritable: credential.writable,
      tokenSource: credential.source,
      enabled: config.enabled,
      running: Boolean(this.pollTask && !this.pollController?.signal.aborted && this.activeApi && this.pollHealthy),
      bot: this.bot ? { id: String(this.bot.id), username: this.bot.username, name: this.bot.first_name } : undefined,
      lastError: this.lastError,
      principals: config.principals.map(({ userId, chatId, label, pairedAt }) => ({ userId, chatId, label, pairedAt })),
      bindingCount: config.bindings.length,
      ownedSessionCount: config.ownedSessions.length,
      options: {
        defaultCwd: config.defaultCwd,
        agentPreset: config.agentPreset,
        allowExistingSessions: config.allowExistingSessions,
        allowSteer: config.allowSteer,
      },
    };
  }

  async configureToken(input) {
    const token = normalizeBotToken(input);
    const api = this.apiFactory(token);
    const bot = await api.getMe({ signal: AbortSignal.timeout(15_000) });
    await this.#bindBotIdentity(bot);
    await this.credentials.set(this.credentialRef, token);
    this.bot = bot;
    this.lastError = undefined;
    await this.reconcile();
    return this.status();
  }

  async removeToken() {
    await this.stop();
    await this.credentials.unset(this.credentialRef);
    this.bot = undefined;
    this.lastError = undefined;
    return this.status();
  }

  async setEnabled(enabled) {
    await this.settings.update({ enabled: enabled === true });
    await this.reconcile();
    return this.status();
  }

  async updateOptions(input) {
    const patch = {};
    if (Object.hasOwn(input ?? {}, "defaultCwd")) {
      patch.defaultCwd = String(input.defaultCwd ?? "").trim();
      if (patch.defaultCwd && (!isAbsolute(patch.defaultCwd) || patch.defaultCwd.includes("\0"))) throw new DshRequestError("Default project directory must be an absolute path");
    }
    if (Object.hasOwn(input ?? {}, "agentPreset")) {
      patch.agentPreset = String(input.agentPreset ?? "").trim();
      if (patch.agentPreset.length > 128 || /[\u0000-\u001f\u007f]/u.test(patch.agentPreset)) throw new DshRequestError("Agent preset ID is invalid");
    }
    if (Object.hasOwn(input ?? {}, "allowExistingSessions")) patch.allowExistingSessions = input.allowExistingSessions === true;
    if (Object.hasOwn(input ?? {}, "allowSteer")) patch.allowSteer = input.allowSteer === true;
    await this.settings.update(patch);
    return this.status();
  }

  generatePairingCode() {
    const code = pairCode();
    this.pairing = { digest: pairDigest(code), expiresAt: this.now() + PAIR_TTL_MS };
    return { code, expiresAt: this.pairing.expiresAt };
  }

  #markRevoked(generation) {
    if (!generation) return;
    this.revokedGenerations.add(generation);
    while (this.revokedGenerations.size > 512) this.revokedGenerations.delete(this.revokedGenerations.values().next().value);
    for (const controller of this.deliveryControllers.get(generation) ?? []) controller.abort(new Error("Telegram access revoked"));
    this.deliveryControllers.delete(generation);
  }

  #isAuthorized(principal) {
    if (!principal?.generation || this.revokedGenerations.has(principal.generation)) return false;
    return this.#principal(principal.userId, principal.chatId)?.generation === principal.generation;
  }

  #assertAuthorized(principal) {
    if (!this.#isAuthorized(principal)) throw new DshRequestError("Telegram access was revoked");
  }

  async revokePrincipal(userId, chatId) {
    const config = this.settings.get();
    const targetUser = String(userId ?? "");
    const targetChat = String(chatId ?? "");
    const revoked = config.principals.filter((row) => row.userId === targetUser && row.chatId === targetChat);
    for (const principal of revoked) this.#markRevoked(principal.generation);
    const generations = new Set(revoked.map((row) => row.generation));
    const cancelSessions = new Set(config.bindings.filter((row) => row.userId === targetUser && row.chatId === targetChat).map((row) => row.sessionId));
    for (const [rpcId, pending] of this.submittedRpcIds) {
      if (!generations.has(pending.generation)) continue;
      if (pending.sessionId) cancelSessions.add(pending.sessionId);
      this.submittedRpcIds.delete(rpcId);
    }
    for (const state of this.turns.values()) {
      for (const [generation, recipient] of state.recipients) {
        if (!generations.has(generation)) continue;
        cancelSessions.add(recipient.sessionId);
        state.recipients.delete(generation);
      }
    }
    await this.settings.update({
      principals: config.principals.filter((row) => row.userId !== targetUser || row.chatId !== targetChat),
      bindings: config.bindings.filter((row) => row.userId !== targetUser || row.chatId !== targetChat),
      ownedSessions: config.ownedSessions.filter((row) => row.userId !== targetUser || row.chatId !== targetChat),
    });
    await Promise.allSettled([...cancelSessions].map((sessionId) => this.#rpc("cancel", { sessionId })));
    return this.status();
  }

  async clearWebhook() {
    const token = await this.#token();
    if (!token) throw new DshRequestError("Configure a Telegram bot token first");
    const api = this.apiFactory(token);
    await api.call("deleteWebhook", { drop_pending_updates: false }, { signal: AbortSignal.timeout(15_000) });
    this.lastError = undefined;
    await this.reconcile();
    return this.status();
  }

  reconcile() {
    this.reconcileTail = this.reconcileTail.catch(() => {}).then(async () => {
      await this.stop();
      if (this.settings.get().enabled) await this.start();
    });
    return this.reconcileTail;
  }

  async start() {
    if (this.pollTask) return;
    const token = await this.#token();
    if (!token) {
      this.lastError = "Configure a Telegram bot token before enabling remote access";
      return;
    }
    const controller = new AbortController();
    this.pollController = controller;
    this.pollTask = this.#poll(token, controller.signal).catch((error) => {
      if (!controller.signal.aborted) {
        this.lastError = displayError(error);
        this.logger?.warn?.("telegram: polling stopped: %s", this.lastError);
      }
    }).finally(() => {
      if (this.pollController === controller) {
        this.activeApi = undefined;
        this.pollHealthy = false;
        this.pollController = undefined;
        this.pollTask = undefined;
      }
    });
  }

  async #stopDeliveries() {
    for (const controllers of this.deliveryControllers.values()) {
      for (const controller of controllers) controller.abort(new Error("Telegram plugin stopped"));
    }
    this.deliveryControllers.clear();
    await Promise.allSettled([...this.deliveryTasks]);
  }

  async stop() {
    const task = this.pollTask;
    if (task) {
      this.pollController?.abort(new Error("Telegram plugin stopped"));
      await task.catch(() => {});
    }
    await this.#stopDeliveries();
  }

  async dispose() {
    await this.stop();
    this.pairing = undefined;
    this.submittedRpcIds.clear();
    this.turns.clear();
  }

  async #poll(token, signal) {
    const api = this.apiFactory(token);
    this.activeApi = api;
    this.bot = await api.getMe({ signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    await this.#bindBotIdentity(this.bot);
    const lease = await this.leaseFactory(String(this.bot.id));
    try {
      await this.#pollOwned(api, signal);
    } finally {
      await lease.release();
    }
  }

  async #pollOwned(api, signal) {
    const webhook = await api.call("getWebhookInfo", {}, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    if (webhook?.url) throw new DshRequestError("This bot has a webhook configured. Clear it locally before enabling long polling");
    await api.call("setMyCommands", { commands: [
      { command: "help", description: "Show remote-control commands" },
      { command: "sessions", description: "List available DSH sessions" },
      { command: "new", description: "Create and select a session" },
      { command: "status", description: "Show selected session and DSH state" },
      { command: "history", description: "Show recent conversation text" },
      { command: "cancel", description: "Stop the active turn" },
    ] }, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    this.pollHealthy = true;

    let nextUpdateId = this.settings.get().lastUpdateId > 0 ? this.settings.get().lastUpdateId + 1 : 0;
    if (nextUpdateId === 0) {
      const tail = await api.getUpdates({ offset: -1, limit: 1, timeout: 0, allowed_updates: ["message", "callback_query"] }, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
      if (tail.length) {
        const lastUpdateId = tail.at(-1).update_id;
        await this.settings.update({ lastUpdateId });
        nextUpdateId = lastUpdateId + 1;
      }
    }

    this.lastError = undefined;
    let failures = 0;
    while (!signal.aborted) {
      try {
        const updates = await api.getUpdates({
          offset: nextUpdateId || undefined,
          limit: 25,
          timeout: 25,
          allowed_updates: ["message", "callback_query"],
        }, { signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]) });
        failures = 0;
        this.pollHealthy = true;
        this.lastError = undefined;
        for (const update of updates) {
          if (!Number.isSafeInteger(update?.update_id) || update.update_id < nextUpdateId) continue;
          // Reserve durably before mutation: ambiguous network failures never replay a prompt or session creation.
          await this.settings.update({ lastUpdateId: update.update_id });
          nextUpdateId = update.update_id + 1;
          try {
            await this.#handleUpdate(api, update, signal);
          } catch (error) {
            this.logger?.warn?.("telegram: update rejected: %s", displayError(error));
            const chatId = update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
            if (chatId !== undefined) await sendTelegramText(api, chatId, displayError(error), {}, { signal }).catch(() => {});
          }
        }
      } catch (error) {
        if (signal.aborted) break;
        if (error instanceof TelegramApiError && [401, 403, 409].includes(error.code)) throw error;
        failures += 1;
        this.pollHealthy = false;
        const retryMs = error instanceof TelegramApiError && error.retryAfterSeconds
          ? Math.min(error.retryAfterSeconds * 1000, 300_000)
          : Math.min(500 * 2 ** Math.min(failures, 9), 300_000);
        this.lastError = displayError(error);
        this.logger?.warn?.("telegram: polling retry scheduled: %s", this.lastError);
        await delay(retryMs, signal).catch(() => {});
      }
    }
  }

  #principal(userId, chatId) {
    return this.settings.get().principals.find((row) => row.userId === String(userId) && row.chatId === String(chatId));
  }

  async #handleUpdate(api, update, signal) {
    const timestamp = updateTimestamp(update);
    if (timestamp !== undefined && this.now() - timestamp > MAX_UPDATE_AGE_MS) {
      if (update.callback_query?.id) await api.answerCallbackQuery(update.callback_query.id, "This action expired", { signal });
      return;
    }
    if (update.callback_query) return this.#handleCallback(api, update.callback_query, signal);
    const message = update.message;
    if (!isPrivateMessage(message) || typeof message?.text !== "string") return;
    const userId = String(message.from.id);
    const chatId = String(message.chat.id);
    const command = parseTelegramCommand(message.text);
    const principal = this.#principal(userId, chatId);
    if (!principal) return this.#handleUnpaired(api, message, command, signal);
    const commandRate = this.commandLimiter.consume(`${userId}:${chatId}`);
    if (!commandRate.allowed) throw new DshRequestError(`Too many commands. Retry in ${Math.ceil(commandRate.retryAfterMs / 1000)} seconds`);
    return this.#handleAuthorized(api, message, principal, command, signal);
  }

  async #handleUnpaired(api, message, command, signal) {
    const userId = String(message.from.id);
    const chatId = String(message.chat.id);
    if (command?.name === "pair") {
      const rate = this.pairLimiter.consume(`${userId}:${chatId}`);
      if (!rate.allowed) throw new DshRequestError(`Too many pairing attempts. Retry in ${Math.ceil(rate.retryAfterMs / 60_000)} minutes`);
      if (!this.pairing || this.pairing.expiresAt <= this.now() || !equalDigest(this.pairing.digest, pairDigest(command.args))) {
        throw new DshRequestError("Pairing code is invalid or expired");
      }
      const config = this.settings.get();
      const principals = [...config.principals.filter((row) => row.userId !== userId || row.chatId !== chatId), {
        userId,
        chatId,
        generation: randomUUID(),
        label: safeLabel(message.from),
        pairedAt: this.now(),
      }].slice(-MAX_STATE_ROWS);
      await this.settings.update({ principals });
      this.pairing = undefined;
      this.pairLimiter.clear(`${userId}:${chatId}`);
      await sendTelegramText(api, chatId, "Paired successfully. Use /new to create a remote session or /sessions to select one you are allowed to access.", {}, { signal });
      return;
    }
    if (command?.name === "whoami" || command?.name === "start" || command?.name === "help") {
      await sendTelegramText(api, chatId, `Not paired.\n\nTelegram user ID: ${userId}\nChat ID: ${chatId}\n\nGenerate a one-time pairing code locally in DSH Settings → Telegram, then send /pair CODE here.`, {}, { signal });
    }
  }

  async #handleAuthorized(api, message, principal, command, signal) {
    const chatId = principal.chatId;
    if (!command) return this.#prompt(api, principal, message.text, "queue", signal);
    switch (command.name) {
      case "start":
      case "help":
        return sendTelegramText(api, chatId, this.#helpText(), {}, { signal });
      case "whoami":
        return sendTelegramText(api, chatId, `Paired as ${principal.label}.\nUser ID: ${principal.userId}\nChat ID: ${principal.chatId}`, {}, { signal });
      case "status":
        return this.#sendStatus(api, principal, signal);
      case "sessions":
        return this.#sendSessions(api, principal, signal);
      case "use":
        return this.#useSession(api, principal, command.args, signal);
      case "new":
        return this.#newSession(api, principal, command.args, signal);
      case "history":
        return this.#sendHistory(api, principal, command.args, signal);
      case "cancel":
        return this.#cancel(api, principal, signal);
      case "detach":
      case "unlink":
        return this.#detach(api, principal, signal);
      case "ask":
        if (!command.args) throw new DshRequestError("Usage: /ask <message>");
        return this.#prompt(api, principal, command.args, "queue", signal);
      case "steer":
        if (!this.settings.get().allowSteer) throw new DshRequestError("Steering is disabled in local Telegram settings");
        if (!command.args) throw new DshRequestError("Usage: /steer <message>");
        return this.#prompt(api, principal, command.args, "steer", signal);
      case "rename":
        if (!command.args) throw new DshRequestError("Usage: /rename <title>");
        return this.#rename(api, principal, command.args, signal);
      case "pair":
        return sendTelegramText(api, chatId, "This Telegram account is already paired.", {}, { signal });
      default:
        throw new DshRequestError("Unknown command. Use /help");
    }
  }

  #helpText() {
    return [
      "DeepSeek Harness remote control",
      "",
      "/new [title] — create and select a session",
      "/sessions — list sessions you may access",
      "/use <session-prefix> — select a session",
      "/ask <message> — queue a prompt",
      "/history [count] — recent user/final assistant text",
      "/rename <title> — rename selected session",
      "/cancel — stop the selected session's active turn",
      "/detach — clear the selected session",
      "/status — connection and session status",
      "/whoami — show paired identity",
      "",
      "Plain text is treated as /ask. DSH slash commands and remote approvals are intentionally not exposed.",
    ].join("\n");
  }

  async #rpc(method, payload, rpcId = randomUUID()) {
    const target = this.apiProxy.sessions?.[method];
    if (typeof target !== "function") throw new DshRequestError(`DSH session operation '${method}' is unavailable`);
    const response = await target.call(this.apiProxy.sessions, { rpcId, payload });
    if (response?.result?.ok === true) return response.result.value;
    const error = response?.result?.error;
    throw new DshRequestError(error?.message || "DSH rejected the session request", error?.code);
  }

  async #allowedSessions(principal) {
    const { items } = await this.#rpc("list", {});
    const config = this.settings.get();
    const owned = new Set(config.ownedSessions.filter((row) => row.userId === principal.userId && row.chatId === principal.chatId).map((row) => row.sessionId));
    return items.filter((item) => item.origin !== "subagent" && (config.allowExistingSessions || owned.has(String(item.sessionId))));
  }

  #binding(principal) {
    return this.settings.get().bindings.find((row) => row.userId === principal.userId && row.chatId === principal.chatId);
  }

  async #setBinding(principal, sessionId) {
    const config = this.settings.get();
    const bindings = [...config.bindings.filter((row) => row.userId !== principal.userId || row.chatId !== principal.chatId), {
      userId: principal.userId,
      chatId: principal.chatId,
      sessionId: String(sessionId),
      updatedAt: this.now(),
    }].slice(-MAX_STATE_ROWS);
    await this.settings.update({ bindings });
  }

  async #selected(principal, { create = false } = {}) {
    const binding = this.#binding(principal);
    const allowed = await this.#allowedSessions(principal);
    if (binding) {
      const hit = allowed.find((row) => String(row.sessionId) === binding.sessionId);
      if (hit) return hit;
    }
    if (!create) throw new DshRequestError("No session selected. Use /new or /sessions");
    return this.#createSession(principal, "");
  }

  async #createSession(principal, title) {
    this.#assertAuthorized(principal);
    const rate = this.newSessionLimiter.consume(`${principal.userId}:${principal.chatId}`);
    if (!rate.allowed) throw new DshRequestError(`Session creation is limited. Retry in ${Math.ceil(rate.retryAfterMs / 60_000)} minutes`);
    const config = this.settings.get();
    const payload = {};
    if (config.defaultCwd) payload.cwd = config.defaultCwd;
    if (config.agentPreset) payload.agentPreset = config.agentPreset;
    const created = await this.#rpc("create", payload);
    const sessionId = String(created.sessionId);
    const latest = this.settings.get();
    await this.settings.update({
      ownedSessions: [...latest.ownedSessions, {
        userId: principal.userId,
        chatId: principal.chatId,
        sessionId,
        createdAt: this.now(),
      }].slice(-MAX_STATE_ROWS),
    });
    await this.#setBinding(principal, sessionId);
    if (title) await this.#rpc("rename", { sessionId, title: title.slice(0, 200) });
    return { sessionId, running: false, projections: { values: { title: title || null } } };
  }

  async #newSession(api, principal, title, signal) {
    const session = await this.#createSession(principal, title);
    await sendTelegramText(api, principal.chatId, `Created and selected ${titleOf(session)} (${shortId(session.sessionId)}).`, {}, { signal });
  }

  async #sendSessions(api, principal, signal) {
    const items = (await this.#allowedSessions(principal)).slice(0, SESSION_LIST_LIMIT);
    if (!items.length) return sendTelegramText(api, principal.chatId, "No accessible sessions. Use /new to create one.", {}, { signal });
    const selectedId = this.#binding(principal)?.sessionId;
    const lines = items.map((item, index) => `${index + 1}. ${String(item.sessionId) === selectedId ? "●" : "○"} ${titleOf(item)} (${shortId(item.sessionId)})${item.running ? " — running" : ""}`);
    const keyboard = items.map((item) => [{ text: `${String(item.sessionId) === selectedId ? "✓ " : ""}${titleOf(item).slice(0, 48)}`, callback_data: `session:${item.sessionId}` }]);
    await sendTelegramText(api, principal.chatId, `Accessible sessions:\n\n${lines.join("\n")}`, { reply_markup: { inline_keyboard: keyboard } }, { signal });
  }

  async #useSession(api, principal, prefix, signal) {
    const query = String(prefix ?? "").trim();
    if (query.length < 4) throw new DshRequestError("Usage: /use <at-least-4-character session prefix>");
    const matches = (await this.#allowedSessions(principal)).filter((item) => String(item.sessionId).startsWith(query));
    if (matches.length !== 1) throw new DshRequestError(matches.length ? "Session prefix is ambiguous" : "Session is not available to this Telegram account");
    await this.#setBinding(principal, matches[0].sessionId);
    await sendTelegramText(api, principal.chatId, `Selected ${titleOf(matches[0])} (${shortId(matches[0].sessionId)}).`, {}, { signal });
  }

  async #handleCallback(api, callback, signal) {
    const message = callback?.message;
    if (message?.chat?.type !== "private" || callback?.from?.is_bot === true) return;
    const userId = String(callback.from.id);
    const chatId = String(message.chat.id);
    const principal = this.#principal(userId, chatId);
    if (!principal) return api.answerCallbackQuery(callback.id, "Not authorized", { signal });
    const match = /^session:([A-Za-z0-9-]{8,80})$/u.exec(String(callback.data ?? ""));
    if (!match) return api.answerCallbackQuery(callback.id, "Invalid action", { signal });
    const session = (await this.#allowedSessions(principal)).find((item) => String(item.sessionId) === match[1]);
    if (!session) return api.answerCallbackQuery(callback.id, "Session unavailable", { signal });
    await this.#setBinding(principal, session.sessionId);
    await api.answerCallbackQuery(callback.id, `Selected ${titleOf(session).slice(0, 100)}`, { signal });
    await sendTelegramText(api, chatId, `Selected ${titleOf(session)} (${shortId(session.sessionId)}).`, {}, { signal });
  }

  async #prompt(api, principal, input, mode, signal) {
    const text = String(input ?? "").trim();
    if (!text) throw new DshRequestError("Message cannot be empty");
    if (text.startsWith("/")) throw new DshRequestError("DSH slash commands are not available through Telegram");
    if ([...text].length > MAX_PROMPT_CODE_POINTS || Buffer.byteLength(text, "utf8") > MAX_PROMPT_BYTES) throw new DshRequestError("Message is too long (maximum 4,000 characters / 8 KiB)");
    const rate = this.promptLimiter.consume(`${principal.userId}:${principal.chatId}`);
    if (!rate.allowed) throw new DshRequestError(`Prompt limit reached. Retry in ${Math.ceil(rate.retryAfterMs / 1000)} seconds`);
    const session = await this.#selected(principal, { create: true });
    const rpcId = randomUUID();
    if (this.submittedRpcIds.size >= 512) this.submittedRpcIds.delete(this.submittedRpcIds.keys().next().value);
    this.submittedRpcIds.set(rpcId, { userId: principal.userId, chatId: principal.chatId, generation: principal.generation, sessionId: String(session.sessionId), createdAt: this.now() });
    try {
      this.#assertAuthorized(principal);
      await this.#rpc("prompt", { sessionId: session.sessionId, mode, content: [{ type: "text", text }] }, rpcId);
    } catch (error) {
      this.submittedRpcIds.delete(rpcId);
      throw error;
    }
    await sendTelegramText(api, principal.chatId, `${session.running && mode === "queue" ? "Queued" : "Accepted"} in ${titleOf(session)} (${shortId(session.sessionId)}).`, {}, { signal });
  }

  async #sendHistory(api, principal, countArg, signal) {
    const rate = this.historyLimiter.consume(`${principal.userId}:${principal.chatId}`);
    if (!rate.allowed) throw new DshRequestError(`History limit reached. Retry in ${Math.ceil(rate.retryAfterMs / 1000)} seconds`);
    const parsed = countArg ? Number(countArg) : 8;
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20) throw new DshRequestError("History count must be between 1 and 20");
    const session = await this.#selected(principal);
    const { events } = await this.#rpc("history", { sessionId: session.sessionId, maxMessages: parsed });
    const lines = [];
    for (const entry of events) {
      const event = entry.event;
      if (event.type === "user/message" && event.data?.source?.kind === "user") {
        const text = textOf(event.data.content);
        if (text) lines.push(`You: ${text}`);
      } else if (event.type === "assistant/message") {
        const text = textOf(event.data.message?.content);
        if (text) lines.push(`DSH: ${text}`);
      }
    }
    await sendTelegramText(api, principal.chatId, lines.length ? lines.join("\n\n") : "No visible conversation text yet.", {}, { signal });
  }

  async #sendStatus(api, principal, signal) {
    const selected = await this.#selected(principal).catch(() => undefined);
    const config = this.settings.get();
    const text = [
      `Bot: @${this.bot?.username ?? "connected"}`,
      `Access: ${config.allowExistingSessions ? "all root sessions" : "Telegram-created sessions only"}`,
      `Steering: ${config.allowSteer ? "enabled" : "disabled"}`,
      selected ? `Selected: ${titleOf(selected)} (${shortId(selected.sessionId)})${selected.running ? " — running" : ""}` : "Selected: none",
    ].join("\n");
    await sendTelegramText(api, principal.chatId, text, {}, { signal });
  }

  async #cancel(api, principal, signal) {
    const session = await this.#selected(principal);
    await this.#rpc("cancel", { sessionId: session.sessionId });
    await sendTelegramText(api, principal.chatId, `Cancellation requested for ${titleOf(session)}.`, {}, { signal });
  }

  async #rename(api, principal, title, signal) {
    const session = await this.#selected(principal);
    const result = await this.#rpc("rename", { sessionId: session.sessionId, title: title.slice(0, 200) });
    await sendTelegramText(api, principal.chatId, `Renamed selected session to ${result.title}.`, {}, { signal });
  }

  async #detach(api, principal, signal) {
    const config = this.settings.get();
    await this.settings.update({ bindings: config.bindings.filter((row) => row.userId !== principal.userId || row.chatId !== principal.chatId) });
    await sendTelegramText(api, principal.chatId, "Session detached. Use /sessions or /new to select one.", {}, { signal });
  }

  onSessionEvent(session, event) {
    const sessionId = String(session.id);
    if (event.type === "turn/start") {
      this.turns.set(sessionId, { turn: event.data.turn, text: "", recipients: new Map() });
      return;
    }
    const state = this.turns.get(sessionId);
    if (!state) return;
    if (event.type === "user/message") {
      const rpcId = event.data?.source?.rpcId;
      const submitted = rpcId ? this.submittedRpcIds.get(String(rpcId)) : undefined;
      if (submitted) {
        state.recipients.set(submitted.generation, submitted);
        this.submittedRpcIds.delete(String(rpcId));
      }
    } else if (event.type === "assistant/message") {
      const text = textOf(event.data.message?.content);
      if (text) state.text = text;
    } else if (event.type === "turn/end" && event.data.turn === state.turn) {
      this.turns.delete(sessionId);
      if (state.recipients.size) {
        const task = this.#deliverTurn(state, event.data.reason).catch((error) => {
          this.logger?.warn?.("telegram: assistant delivery failed: %s", displayError(error));
        }).finally(() => this.deliveryTasks.delete(task));
        this.deliveryTasks.add(task);
      }
    }
    const expiry = this.now() - 60 * 60 * 1000;
    for (const [rpcId, value] of this.submittedRpcIds) if (value.createdAt < expiry) this.submittedRpcIds.delete(rpcId);
  }

  async #deliverTurn(state, reason) {
    const api = this.activeApi;
    if (!api) return;
    const response = state.text.trim() || `Turn ended: ${String(reason).replace(/[-_]/gu, " ")}`;
    let chunks = splitTelegramText(response, 3500);
    if (chunks.length > MAX_OUTPUT_CHUNKS) {
      chunks = chunks.slice(0, MAX_OUTPUT_CHUNKS);
      chunks[MAX_OUTPUT_CHUNKS - 1] = `${chunks[MAX_OUTPUT_CHUNKS - 1].slice(0, 3200)}\n\n[Output truncated in Telegram. Open DSH for the complete response.]`;
    }
    for (const recipient of state.recipients.values()) {
      if (!this.#isAuthorized(recipient)) continue;
      const controller = new AbortController();
      const controllers = this.deliveryControllers.get(recipient.generation) ?? new Set();
      controllers.add(controller);
      this.deliveryControllers.set(recipient.generation, controllers);
      try {
        for (const chunk of chunks) {
          if (!this.#isAuthorized(recipient)) break;
          await api.sendMessage(recipient.chatId, chunk, { disable_web_page_preview: true }, { signal: controller.signal });
        }
      } finally {
        controllers.delete(controller);
        if (!controllers.size) this.deliveryControllers.delete(recipient.generation);
      }
    }
  }
}

export function createTelegramRpcHandler(controller) {
  return async (endpoint, payload, signal) => {
    try {
      signal.throwIfAborted();
      let value;
      if (endpoint === "status") value = await controller.status();
      else if (endpoint === "configure-token") value = await controller.configureToken(payload?.token);
      else if (endpoint === "remove-token") value = await controller.removeToken();
      else if (endpoint === "set-enabled") value = await controller.setEnabled(payload?.enabled);
      else if (endpoint === "update-options") value = await controller.updateOptions(payload);
      else if (endpoint === "generate-pairing-code") value = controller.generatePairingCode();
      else if (endpoint === "revoke-principal") value = await controller.revokePrincipal(payload?.userId, payload?.chatId);
      else if (endpoint === "clear-webhook") value = await controller.clearWebhook();
      else return { ok: false, error: { code: "not_found", message: "Unknown Telegram endpoint", details: { issues: [] } } };
      signal.throwIfAborted();
      return { ok: true, value };
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: { code: "telegram_failed", message: displayError(error), details: { issues: [] } } };
    }
  };
}
