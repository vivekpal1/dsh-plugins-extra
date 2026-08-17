import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isThemeId } from "./themes.js";

export const name = "community-themes";
export const inject = ["connection"];
const CHANNEL = "/community-themes";
const settingsPath = () => join(homedir(), ".dsh", "community-theme.json");

async function readPreference() {
  try {
    const value = JSON.parse(await readFile(settingsPath(), "utf8"));
    return isThemeId(value?.preference) ? value.preference : "system";
  } catch {
    return "system";
  }
}

async function writePreference(preference) {
  if (!isThemeId(preference)) throw new Error("Unknown theme");
  const path = settingsPath();
  await mkdir(join(homedir(), ".dsh"), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ preference }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return preference;
}

const failure = (message) => ({
  ok: false,
  error: { code: "theme_failed", message, details: { issues: [] } },
});

export function apply(ctx) {
  const handler = async (endpoint, payload, signal) => {
    try {
      signal.throwIfAborted();
      if (endpoint === "get") return { ok: true, value: { preference: await readPreference() } };
      if (endpoint === "set") return { ok: true, value: { preference: await writePreference(payload?.preference) } };
      return failure("Unknown community-themes endpoint");
    } catch (error) {
      if (signal.aborted) throw error;
      return failure(error instanceof Error ? error.message : "Could not save theme");
    }
  };
  ctx.effect(
    () => ctx.connection.rpc.handle(CHANNEL, handler, { authority: "loopback" }),
    "community-themes: preference RPC",
  );
}

export { readPreference, writePreference };
