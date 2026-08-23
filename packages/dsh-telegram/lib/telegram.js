const BOT_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,100}$/u;
const COMMAND = /^\/([a-z][a-z0-9_]*)(?:@[A-Za-z0-9_]{3,32})?(?:\s+([\s\S]*))?$/iu;
export const TELEGRAM_TEXT_LIMIT = 4096;

export class TelegramApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TelegramApiError";
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function normalizeBotToken(input) {
  if (typeof input !== "string") throw new Error("Enter a Telegram bot token");
  const value = input.trim();
  if (!BOT_TOKEN.test(value)) throw new Error("Telegram bot token format is invalid");
  return value;
}

export function parseTelegramCommand(text) {
  if (typeof text !== "string") return undefined;
  const match = COMMAND.exec(text.trim());
  if (!match) return undefined;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

function codeUnitCut(text, start, maxUnits) {
  let end = Math.min(start + maxUnits, text.length);
  if (end < text.length) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xD800 && code <= 0xDBFF) end -= 1;
  }
  return end;
}

export function splitTelegramText(input, limit = TELEGRAM_TEXT_LIMIT) {
  const text = String(input ?? "");
  if (!Number.isSafeInteger(limit) || limit < 32 || limit > TELEGRAM_TEXT_LIMIT) throw new Error("Telegram chunk limit is invalid");
  if (text.length === 0) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = codeUnitCut(text, start, limit);
    if (end < text.length) {
      const window = text.slice(start, end);
      const newline = window.lastIndexOf("\n");
      const space = window.lastIndexOf(" ");
      const boundary = Math.max(newline, space);
      if (boundary >= Math.floor(limit * 0.55)) end = start + boundary + 1;
    }
    if (end <= start) end = codeUnitCut(text, start, limit);
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export class SlidingWindowRateLimiter {
  constructor({ limit, windowMs, now = Date.now, maxKeys = 2048 }) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("Rate window must be a positive integer");
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new Error("Rate-limit key capacity must be a positive integer");
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
    this.entries = new Map();
  }

  consume(key) {
    const normalizedKey = String(key);
    if (!this.entries.has(normalizedKey) && this.entries.size >= this.maxKeys) this.entries.delete(this.entries.keys().next().value);
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.entries.get(normalizedKey) ?? []).filter((value) => value > cutoff);
    if (recent.length >= this.limit) {
      this.entries.set(normalizedKey, recent);
      return { allowed: false, retryAfterMs: Math.max(1, recent[0] + this.windowMs - now) };
    }
    recent.push(now);
    this.entries.set(String(key), recent);
    return { allowed: true, retryAfterMs: 0 };
  }

  clear(key) {
    this.entries.delete(String(key));
  }
}

function safeApiMessage(code) {
  if (code === 401) return "Telegram rejected the bot token";
  if (code === 403) return "Telegram denied access to this chat";
  if (code === 409) return "Telegram long polling is already active in another process";
  if (code === 429) return "Telegram rate limit reached";
  return "Telegram API request failed";
}

export class TelegramApi {
  constructor(token, options = {}) {
    this.token = normalizeBotToken(token);
    this.fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.fetch !== "function") throw new Error("Telegram requires fetch support");
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  async call(method, payload = {}, options = {}) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: options.signal,
      });
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      throw new TelegramApiError("Could not reach Telegram", { cause });
    }
    let body;
    try {
      body = await response.json();
    } catch (cause) {
      throw new TelegramApiError("Telegram returned an unreadable response", { code: response.status, cause });
    }
    if (!response.ok || body?.ok !== true) {
      const code = Number(body?.error_code) || response.status;
      throw new TelegramApiError(safeApiMessage(code), {
        code,
        retryAfterSeconds: Number(body?.parameters?.retry_after) || undefined,
      });
    }
    return body.result;
  }

  getMe(options) {
    return this.call("getMe", {}, options);
  }

  getUpdates(payload, options) {
    return this.call("getUpdates", payload, options);
  }

  sendMessage(chatId, text, extra = {}, options) {
    return this.call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...extra }, options);
  }

  answerCallbackQuery(callbackQueryId, text, options) {
    return this.call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) }, options);
  }
}

export async function sendTelegramText(api, chatId, text, extra = {}, options = {}) {
  const chunks = splitTelegramText(text, options.limit ?? 3900);
  const results = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const messageExtra = index === 0 ? extra : {};
    try {
      results.push(await api.sendMessage(chatId, chunks[index], messageExtra, options));
    } catch (error) {
      if (!(error instanceof TelegramApiError) || error.code !== 429 || !error.retryAfterSeconds) throw error;
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(options.signal.reason ?? new Error("Telegram send aborted"));
        };
        const timer = setTimeout(() => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, Math.min(error.retryAfterSeconds * 1000, 30_000));
        options.signal?.addEventListener("abort", onAbort, { once: true });
      });
      results.push(await api.sendMessage(chatId, chunks[index], messageExtra, options));
    }
  }
  return results;
}
