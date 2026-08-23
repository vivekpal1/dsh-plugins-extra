import assert from "node:assert/strict";
import test from "node:test";
import {
  SlidingWindowRateLimiter,
  TelegramApi,
  normalizeBotToken,
  parseTelegramCommand,
  sendTelegramText,
  splitTelegramText,
} from "../lib/telegram.js";

const TOKEN = `123456789:${"A".repeat(35)}`;

test("normalizes bot tokens without accepting malformed values", () => {
  assert.equal(normalizeBotToken(`  ${TOKEN}  `), TOKEN);
  for (const value of ["", "123:no", "abc:token", `${TOKEN} extra`, undefined]) {
    assert.throws(() => normalizeBotToken(value), /token/i);
  }
});

test("parses commands with optional bot usernames", () => {
  assert.deepEqual(parseTelegramCommand("/NEW Project alpha"), { name: "new", args: "Project alpha" });
  assert.deepEqual(parseTelegramCommand("/status@my_remote_bot"), { name: "status", args: "" });
  assert.equal(parseTelegramCommand("ordinary prompt"), undefined);
});

test("chunks Telegram text without splitting surrogate pairs or losing content", () => {
  const text = `${"alpha beta\n".repeat(700)}${"🧪".repeat(1000)}`;
  const chunks = splitTelegramText(text, 3500);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(""), text);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 3500);
    const last = chunk.charCodeAt(chunk.length - 1);
    assert.ok(!(last >= 0xD800 && last <= 0xDBFF));
  }
});

test("enforces a sliding-window rate limit", () => {
  let now = 1_000;
  const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 100, now: () => now });
  assert.equal(limiter.consume("user").allowed, true);
  assert.equal(limiter.consume("user").allowed, true);
  assert.equal(limiter.consume("user").allowed, false);
  now += 101;
  assert.equal(limiter.consume("user").allowed, true);
});

test("rate-limit state is bounded under many distinct identities", () => {
  const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 10_000, maxKeys: 3 });
  for (const key of ["a", "b", "c", "d", "e"]) limiter.consume(key);
  assert.equal(limiter.entries.size, 3);
  assert.deepEqual([...limiter.entries.keys()], ["c", "d", "e"]);
});

test("Telegram API errors never include the bot token", async () => {
  const api = new TelegramApi(TOKEN, {
    fetch: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error_code: 401, description: `bad ${TOKEN}` }),
    }),
  });
  await assert.rejects(() => api.getMe(), (error) => {
    assert.match(error.message, /rejected/i);
    assert.equal(error.message.includes(TOKEN), false);
    return true;
  });
});

test("sendTelegramText preserves text and applies markup only to the first chunk", async () => {
  const calls = [];
  const api = { sendMessage: async (...args) => { calls.push(args); return { message_id: calls.length }; } };
  const text = "x".repeat(8000);
  await sendTelegramText(api, "1", text, { reply_markup: { inline_keyboard: [] } }, { limit: 3900 });
  assert.equal(calls.map((call) => call[1]).join(""), text);
  assert.deepEqual(calls[0][2], { reply_markup: { inline_keyboard: [] } });
  assert.deepEqual(calls[1][2], {});
});
