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

function omissionSummary() {
  return {
    injectedContext: 0,
    reasoning: 0,
    toolActivity: 0,
    metaOrSidechain: 0,
    unsupportedContent: 0,
  };
}

function classifyNonTextBlock(block, omissions) {
  const type = typeof block?.type === "string" ? block.type : "";
  if (type === "tool_use" || type === "tool_result" || type.includes("tool") || type.includes("function_call")) {
    omissions.toolActivity += 1;
  } else if (type === "thinking" || type === "reasoning" || type.includes("thought")) {
    omissions.reasoning += 1;
  } else {
    omissions.unsupportedContent += 1;
  }
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
  const omissions = omissionSummary();
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
    if (!item) return;
    if (item.type === "reasoning") {
      omissions.reasoning += 1;
      return;
    }
    if (item.type !== "message") {
      if (typeof item.type === "string" && (item.type.includes("tool") || item.type.includes("function_call"))) omissions.toolActivity += 1;
      return;
    }
    if (!["user", "assistant"].includes(item.role)) {
      omissions.injectedContext += 1;
      return;
    }
    const content = Array.isArray(item.content) ? item.content : [item.content];
    for (const block of content) {
      if (block && typeof block === "object" && typeof (block.text ?? block.input_text ?? block.output_text) !== "string") {
        classifyNonTextBlock(block, omissions);
      }
    }
    let blocks = textBlocks(item.content);
    if (item.role === "user") {
      blocks = blocks.filter((text) => {
        const injected = CODEX_CONTEXT_PREFIXES.some((prefix) => text.trimStart().startsWith(prefix));
        if (injected) omissions.injectedContext += 1;
        return !injected;
      });
    }
    pushMessage(messages, item.role, blocks.join("\n\n"));
  });
  return { messages, cwd, createdAt, omissions };
}

export async function parseClaudeSession(path) {
  const messages = [];
  const omissions = omissionSummary();
  let cwd;
  let createdAt;
  let title;
  await readJsonLines(path, (row) => {
    cwd ??= typeof row?.cwd === "string" ? row.cwd : undefined;
    const timestamp = Date.parse(row?.timestamp ?? "");
    if (Number.isFinite(timestamp)) createdAt ??= timestamp;
    if (row?.type === "ai-title" && typeof row.title === "string") title = row.title;
    if (row.isMeta === true || row.isSidechain === true) {
      omissions.metaOrSidechain += 1;
      return;
    }
    if (!["user", "assistant"].includes(row?.type)) return;
    const role = row.message?.role;
    if (!["user", "assistant"].includes(role)) {
      omissions.unsupportedContent += 1;
      return;
    }
    const content = row.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) if (block?.type !== "text") classifyNonTextBlock(block, omissions);
    }
    const blocks = typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content.filter((block) => block?.type === "text").map((block) => block.text)
        : [];
    pushMessage(messages, role, blocks.filter((text) => typeof text === "string").join("\n\n"));
  });
  return { messages, cwd, createdAt, title, omissions };
}

export function fallbackTitle(messages, source, sourceId) {
  const first = messages.find((message) => message.role === "user")?.text ?? `${source} ${sourceId}`;
  const singleLine = first.replace(/\s+/g, " ").trim();
  return singleLine.slice(0, 96) || `${source} ${sourceId}`;
}
