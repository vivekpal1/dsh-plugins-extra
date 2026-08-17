import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importSession } from "../lib/index.js";

function fakeContext() {
  const created = [];
  return {
    created,
    sessions: {
      create(id, options) {
        const session = {
          id,
          header: { id, cwd: options.meta.cwd },
          events: [],
          append(type, value) {
            const event = { seq: this.events.length + 1, type, value };
            this.events.push(event);
            return event;
          },
        };
        created.push(session);
        return session;
      },
      async flush() { return true; },
    },
    sessionTitle: {
      rename(session, title) { session.title = title; },
    },
  };
}

async function codexFixture(home, sourceId) {
  const directory = join(home, ".codex", "sessions", "2026", "08", "17");
  await mkdir(directory, { recursive: true });
  const rows = [
    { type: "session_meta", payload: { cwd: "/project", timestamp: "2026-08-17T00:00:00Z" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Build it" }] } },
    { type: "response_item", payload: { type: "function_call", name: "shell" } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } },
  ];
  await writeFile(join(directory, `${sourceId}.jsonl`), `${rows.map(JSON.stringify).join("\n")}\n`);
}

test("an exact source session is imported once and returns durable provenance", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-import-registry-"));
  const sourceId = "019ff56e-d12b-7720-b34b-7b9b8da8db5a";
  await codexFixture(home, sourceId);
  const ctx = fakeContext();
  const first = await importSession(ctx, { source: "codex", sourceId }, { home });
  const duplicate = await importSession(ctx, { source: "codex", sourceId }, { home });

  assert.equal(first.duplicate, undefined);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.sessionId, first.sessionId);
  assert.equal(ctx.created.length, 1);
  assert.equal(first.messageCount, 2);
  assert.equal(first.omissions.toolActivity, 1);
  assert.match(first.provenance.fingerprint, /^sha256:[0-9a-f]{64}$/u);

  const registryPath = join(home, ".dsh", "session-imports.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(registry.version, 2);
  assert.equal(registry.imports[`codex:${sourceId}`].sessionId, first.sessionId);
  assert.equal((await stat(registryPath)).mode & 0o777, 0o600);
});

test("concurrent requests for one source share a single import", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-import-concurrent-"));
  const sourceId = "119ff56e-d12b-7720-b34b-7b9b8da8db5a";
  await codexFixture(home, sourceId);
  const ctx = fakeContext();
  const [first, second] = await Promise.all([
    importSession(ctx, { source: "codex", sourceId }, { home }),
    importSession(ctx, { source: "codex", sourceId }, { home }),
  ]);
  assert.equal(ctx.created.length, 1);
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(second.duplicate, true);
});
