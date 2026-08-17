import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { fallbackTitle, parseClaudeSession, parseCodexSession } from "./parser.js";

export const name = "session-import";
export const inject = ["sessions", "sessionTitle", "connection"];
const CHANNEL = "/session-import";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function findById(roots, id) {
  const expected = `${id}.jsonl`;
  const pending = [...roots];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && (entry.name === expected || entry.name.includes(id) && entry.name.endsWith(".jsonl"))) return path;
    }
  }
  return undefined;
}

async function codexTitle(home, sourceId) {
  try {
    const lines = (await readFile(join(home, ".codex", "session_index.jsonl"), "utf8")).split("\n");
    for (const line of lines) {
      if (!line.includes(sourceId)) continue;
      const row = JSON.parse(line);
      if (row.id === sourceId && typeof row.thread_name === "string") return row.thread_name;
    }
  } catch {}
  return undefined;
}

async function loadRegistry(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

async function saveRegistry(path, registry) {
  await mkdir(join(homedir(), ".dsh"), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function publicError(message) {
  return { ok: false, error: { code: "import_failed", message, details: { issues: [] } } };
}

function turnGroups(messages) {
  const groups = [];
  for (const message of messages) {
    if (message.role === "user") groups.push({ user: message.text, assistants: [] });
    else if (groups.length) groups.at(-1).assistants.push(message.text);
  }
  return groups;
}

function appendImportedConversation(session, messages, source, sourceId) {
  let turn = 0;
  const humanSeqs = [];
  for (const group of turnGroups(messages)) {
    turn += 1;
    session.append("turn/start", { turn });
    const user = {
      id: randomUUID(),
      role: "user",
      content: [{ type: "text", text: group.user }],
      source: { kind: "plugin", plugin: "dsh-session-import", form: "recall" },
    };
    const entered = session.append("user/message", user, { surfaceOp: "append" });
    humanSeqs.push(entered.seq);
    if (group.assistants.length) {
      session.append("step/start", { turn, step: 1 });
      const assistant = {
        id: randomUUID(),
        role: "assistant",
        content: [{ type: "text", text: group.assistants.join("\n\n") }],
        source: { kind: "model", provider: `imported-${source}`, model: `session-${sourceId}` },
      };
      session.append("assistant/message", { turn, step: 1, message: assistant }, { surfaceOp: "append" });
      session.append("step/end", { turn, step: 1 });
    }
    session.append("turn/end", { turn, reason: { kind: "completed" } });
  }
  return humanSeqs;
}

async function importSession(ctx, payload) {
  const source = payload?.source;
  const sourceId = payload?.sourceId?.trim();
  if (!["codex", "claude"].includes(source)) throw new Error("Choose Codex or Claude Code");
  if (!UUID.test(sourceId ?? "")) throw new Error("Enter a valid session UUID");

  const home = homedir();
  const registryPath = join(home, ".dsh", "session-imports.json");
  const registry = await loadRegistry(registryPath);
  const key = `${source}:${sourceId}`;
  if (registry[key]?.sessionId) return { ...registry[key], duplicate: true };

  const roots = source === "codex"
    ? [join(home, ".codex", "sessions"), join(home, ".codex", "archived_sessions")]
    : [join(home, ".claude", "projects")];
  const path = await findById(roots, sourceId);
  if (!path) throw new Error(`${source === "codex" ? "Codex" : "Claude Code"} session was not found locally`);

  const parsed = source === "codex" ? await parseCodexSession(path) : await parseClaudeSession(path);
  if (!parsed.messages.some((message) => message.role === "user")) throw new Error("No human conversation messages were found");
  const title = (source === "codex" ? await codexTitle(home, sourceId) : parsed.title)
    ?? fallbackTitle(parsed.messages, source, sourceId);
  const sessionId = `session-${randomUUID()}`;
  const session = ctx.sessions.create(sessionId, {
    meta: {
      cwd: parsed.cwd || process.cwd(),
      createdAt: parsed.createdAt || Date.now(),
      delegationDepth: 0,
      agentPreset: "standard",
    },
  });
  appendImportedConversation(session, parsed.messages, source, sourceId);
  ctx.sessionTitle.rename(session, title);
  await ctx.sessions.flush(session);

  const result = {
    sessionId,
    source,
    sourceId,
    title,
    messageCount: parsed.messages.length,
    cwd: session.header.cwd,
    importedAt: new Date().toISOString(),
  };
  registry[key] = result;
  await saveRegistry(registryPath, registry);
  return result;
}

export function apply(ctx) {
  const handler = async (endpoint, payload, signal) => {
    try {
      signal.throwIfAborted();
      if (endpoint !== "import") return publicError("Unknown session-import endpoint");
      const value = await importSession(ctx, payload);
      signal.throwIfAborted();
      return { ok: true, value };
    } catch (error) {
      if (signal.aborted) throw error;
      return publicError(error instanceof Error ? error.message : "Session import failed");
    }
  };
  ctx.effect(
    () => ctx.connection.rpc.handle(CHANNEL, handler, { authority: "loopback" }),
    "session-import: loopback import RPC",
  );
}

export { importSession, appendImportedConversation };
