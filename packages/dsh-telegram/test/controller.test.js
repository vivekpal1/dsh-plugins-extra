import assert from "node:assert/strict";
import test from "node:test";
import { TelegramController, createTelegramRpcHandler } from "../lib/controller.js";

const TOKEN = `123456789:${"B".repeat(35)}`;

function settingsStore(overrides = {}) {
  let value = {
    enabled: false,
    principals: [],
    bindings: [],
    ownedSessions: [],
    defaultCwd: "",
    agentPreset: "",
    allowExistingSessions: false,
    allowSteer: false,
    lastUpdateId: 0,
    ...overrides,
  };
  return {
    get: () => structuredClone(value),
    update: async (patch) => { value = { ...value, ...structuredClone(patch) }; },
  };
}

function credentialStore() {
  let value;
  return {
    resolve: async () => value ? { value, source: "test" } : undefined,
    describe: async () => ({ configured: Boolean(value), writable: true, ...(value ? { source: "test" } : {}) }),
    set: async (_ref, next) => { value = next; },
    unset: async () => { value = undefined; },
  };
}

function fakeApi() {
  return {
    getMe: async () => ({ id: 42, username: "dsh_test_bot", first_name: "DSH Test" }),
    call: async (method) => method === "getWebhookInfo" ? { url: "" } : true,
    getUpdates: async (_payload, { signal } = {}) => new Promise((resolve) => {
      if (!signal) return resolve([]);
      if (signal.aborted) return resolve([]);
      signal.addEventListener("abort", () => resolve([]), { once: true });
    }),
    sendMessage: async () => ({ message_id: 1 }),
    answerCallbackQuery: async () => true,
  };
}

function controller(options = {}) {
  return new TelegramController({
    settings: options.settings ?? settingsStore(),
    credentials: options.credentials ?? credentialStore(),
    credentialRef: "DSH_TELEGRAM_BOT_TOKEN",
    apiProxy: { sessions: {} },
    apiFactory: options.apiFactory ?? (() => fakeApi()),
    leaseFactory: options.leaseFactory ?? (async () => ({ release: async () => {} })),
    logger: { warn() {} },
  });
}

test("status is deny-by-default with no configured token or principals", async () => {
  const instance = controller();
  const status = await instance.status();
  assert.equal(status.enabled, false);
  assert.equal(status.running, false);
  assert.equal(status.tokenConfigured, false);
  assert.deepEqual(status.principals, []);
});

test("configuring a token verifies it and stores it only through credentials", async () => {
  const settings = settingsStore();
  const credentials = credentialStore();
  let verified = false;
  const instance = controller({ settings, credentials, apiFactory: (token) => {
    assert.equal(token, TOKEN);
    const api = fakeApi();
    api.getMe = async () => { verified = true; return { id: 7, username: "secure_bot", first_name: "Secure" }; };
    return api;
  } });
  const status = await instance.configureToken(TOKEN);
  assert.equal(verified, true);
  assert.equal(status.tokenConfigured, true);
  assert.equal(JSON.stringify(settings.get()).includes(TOKEN), false);
  assert.equal((await credentials.resolve("DSH_TELEGRAM_BOT_TOKEN")).value, TOKEN);
  await instance.dispose();
});

test("remote-created session policy rejects relative project paths", async () => {
  const instance = controller();
  await assert.rejects(() => instance.updateOptions({ defaultCwd: "../escape" }), /absolute path/u);
  const status = await instance.updateOptions({ defaultCwd: "/safe/project", agentPreset: "telegram-safe" });
  assert.equal(status.options.defaultCwd, "/safe/project");
  assert.equal(status.options.agentPreset, "telegram-safe");
});

test("pairing codes are random-looking, expiring values returned only by generation", () => {
  const instance = controller();
  const first = instance.generatePairingCode();
  const second = instance.generatePairingCode();
  assert.match(first.code, /^[23456789A-HJ-NP-Z]{8}$/u);
  assert.notEqual(first.code, second.code);
  assert.ok(first.expiresAt > Date.now());
});

test("RPC handler redacts unexpected failures", async () => {
  const handler = createTelegramRpcHandler({
    status: async () => { throw new Error(`internal secret ${TOKEN}`); },
  });
  const result = await handler("status", {}, new AbortController().signal);
  assert.equal(result.ok, false);
  assert.equal(result.error.message.includes(TOKEN), false);
});

test("enabling without a token fails closed instead of starting polling", async () => {
  const settings = settingsStore();
  const instance = controller({ settings });
  const status = await instance.setEnabled(true);
  assert.equal(status.enabled, true);
  assert.equal(status.running, false);
  assert.match(status.lastError, /token/i);
});

test("a fresh one-time code pairs only the exact private user and chat", async () => {
  const settings = settingsStore({ enabled: true, botId: "42", lastUpdateId: 100 });
  const credentials = credentialStore();
  await credentials.set("DSH_TELEGRAM_BOT_TOKEN", TOKEN);
  const sent = [];
  let updates;
  let delivered = false;
  const api = fakeApi();
  api.sendMessage = async (chatId, text) => { sent.push({ chatId: String(chatId), text }); return { message_id: sent.length }; };
  api.getUpdates = async (_payload, { signal } = {}) => {
    if (!delivered) {
      delivered = true;
      return updates;
    }
    return new Promise((resolve) => signal.addEventListener("abort", () => resolve([]), { once: true }));
  };
  const instance = controller({ settings, credentials, apiFactory: () => api });
  const pairing = instance.generatePairingCode();
  updates = [{
    update_id: 101,
    message: {
      date: Math.floor(Date.now() / 1000),
      text: `/pair ${pairing.code}`,
      from: { id: 777, first_name: "Owner", is_bot: false },
      chat: { id: 777, type: "private" },
    },
  }];
  await instance.start();
  for (let index = 0; index < 50 && settings.get().principals.length === 0; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(settings.get().principals.map(({ userId, chatId }) => ({ userId, chatId })), [{ userId: "777", chatId: "777" }]);
  assert.equal(settings.get().lastUpdateId, 101);
  assert.match(sent[0].text, /Paired successfully/u);
  assert.equal(JSON.stringify(settings.get()).includes(pairing.code), false);
  await instance.stop();
});
