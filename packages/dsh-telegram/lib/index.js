import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { TelegramController, createTelegramRpcHandler } from "./controller.js";

export const name = "telegram-remote";
export const inject = ["apiProxy", "connection", "credentials", "sessions", "settings"];
export const CHANNEL = "/dsh-telegram";
export const SETTINGS_NAMESPACE = "telegram-remote";
export const CREDENTIAL_REF = credentialRef("DSH_TELEGRAM_BOT_TOKEN");

const identity = {
  userId: z.string(),
  chatId: z.string(),
};

export function apply(ctx) {
  const settings = ctx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), z.object({
    enabled: z.boolean().default(false),
    botId: z.string().default(""),
    principals: z.array(z.object({
      ...identity,
      generation: z.string(),
      label: z.string(),
      pairedAt: z.number(),
    })).default([]),
    bindings: z.array(z.object({
      ...identity,
      sessionId: z.string(),
      updatedAt: z.number(),
    })).default([]),
    ownedSessions: z.array(z.object({
      ...identity,
      sessionId: z.string(),
      createdAt: z.number(),
    })).default([]),
    defaultCwd: z.string().default(""),
    agentPreset: z.string().default(""),
    allowExistingSessions: z.boolean().default(false),
    allowSteer: z.boolean().default(false),
    lastUpdateId: z.number().default(0),
  }));

  const controller = new TelegramController({
    settings,
    credentials: ctx.credentials,
    credentialRef: CREDENTIAL_REF,
    apiProxy: ctx.apiProxy,
    logger: ctx.logger,
  });

  ctx.on("session/event", (session, event) => controller.onSessionEvent(session, event));
  ctx.effect(() => {
    void controller.reconcile();
    return () => controller.dispose();
  }, "telegram: polling lifecycle");
  ctx.effect(
    () => ctx.connection.rpc.handle(CHANNEL, createTelegramRpcHandler(controller), { authority: "loopback" }),
    "telegram: loopback settings RPC",
  );
}

export { TelegramController, createTelegramRpcHandler } from "./controller.js";
export * from "./telegram.js";
