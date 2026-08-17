import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseClaudeSession, parseCodexSession } from "../lib/parser.js";

test("Codex import keeps visible messages and drops injected context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-import-"));
  const path = join(dir, "session.jsonl");
  const rows = [
    { type: "session_meta", payload: { cwd: "/project", timestamp: "2026-01-01T00:00:00Z" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>hidden</environment_context>" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Build it" }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } },
  ];
  await writeFile(path, rows.map(JSON.stringify).join("\n"));
  const parsed = await parseCodexSession(path);
  assert.deepEqual(parsed.messages, [{ role: "user", text: "Build it" }, { role: "assistant", text: "Done" }]);
  assert.equal(parsed.cwd, "/project");
});

test("Claude import ignores tool-only rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-import-"));
  const path = join(dir, "session.jsonl");
  const rows = [
    { type: "user", message: { role: "user", content: "Hello" }, isSidechain: false },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read" }] }, isSidechain: false },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "secret" }] }, isSidechain: false },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] }, isSidechain: false },
  ];
  await writeFile(path, rows.map(JSON.stringify).join("\n"));
  const parsed = await parseClaudeSession(path);
  assert.deepEqual(parsed.messages, [{ role: "user", text: "Hello" }, { role: "assistant", text: "Hi" }]);
});
