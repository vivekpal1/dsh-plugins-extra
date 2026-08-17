import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const CODEX_CONTEXT_PREFIXES = [
  "<recommended_plugins>",
  "# AGENTS.md instructions",
  "<environment_context>",
  "<app-context>",
];

function textBlocks(content) {
  if (typeof content === "string") return content.trim() ? [content] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (block === null || typeof block !== "object") return [];
    const text = block.text ?? block.input_text ?? block.output_text;
    return typeof text === "string" && text.trim() ? [text] : [];
  });
}

function pushMessage(messages, role, text) {
  const cleaned = text.trim();
  if (!cleaned) return;
  const previous = messages.at(-1);
  if (previous?.role === role) {
    previous.text += `\n\n${cleaned}`;
    return;
  }
  messages.push({ role, text: cleaned });
}

async function readJsonLines(path, visit) {
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    visit(value);
  }
}

export async function parseCodexSession(path) {
  const messages = [];
  let cwd;
  let createdAt;
  await readJsonLines(path, (row) => {
    if (row?.type === "session_meta") {
      cwd ??= row.payload?.cwd;
      const timestamp = Date.parse(row.payload?.timestamp ?? row.timestamp ?? "");
      if (Number.isFinite(timestamp)) createdAt ??= timestamp;
      return;
    }
    const item = row?.type === "response_item" ? row.payload : undefined;
    if (item?.type !== "message" || !["user", "assistant"].includes(item.role)) return;
    let blocks = textBlocks(item.content);
    if (item.role === "user") {
      blocks = blocks.filter((text) => !CODEX_CONTEXT_PREFIXES.some((prefix) => text.trimStart().startsWith(prefix)));
    }
    pushMessage(messages, item.role, blocks.join("\n\n"));
  });
  return { messages, cwd, createdAt };
}

export async function parseClaudeSession(path) {
  const messages = [];
  let cwd;
  let createdAt;
  let title;
  await readJsonLines(path, (row) => {
    cwd ??= typeof row?.cwd === "string" ? row.cwd : undefined;
    const timestamp = Date.parse(row?.timestamp ?? "");
    if (Number.isFinite(timestamp)) createdAt ??= timestamp;
    if (row?.type === "ai-title" && typeof row.title === "string") title = row.title;
    if (!["user", "assistant"].includes(row?.type) || row.isMeta === true || row.isSidechain === true) return;
    const role = row.message?.role;
    if (!["user", "assistant"].includes(role)) return;
    const content = row.message?.content;
    const blocks = typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content.filter((block) => block?.type === "text").map((block) => block.text)
        : [];
    pushMessage(messages, role, blocks.filter((text) => typeof text === "string").join("\n\n"));
  });
  return { messages, cwd, createdAt, title };
}

export function fallbackTitle(messages, source, sourceId) {
  const first = messages.find((message) => message.role === "user")?.text ?? `${source} ${sourceId}`;
  const singleLine = first.replace(/\s+/g, " ").trim();
  return singleLine.slice(0, 96) || `${source} ${sourceId}`;
}
