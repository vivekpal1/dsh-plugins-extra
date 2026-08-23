import { test } from "node:test";
import assert from "node:assert/strict";
import { OutputRing } from "../lib/output-ring.js";

test("push and read return the delta with a resume offset", () => {
  const ring = new OutputRing();
  ring.push("hello ");
  ring.push("world");
  const first = ring.read(0);
  assert.equal(first.output, "hello world");
  assert.equal(first.nextOffset, "hello world".length);
  assert.equal(first.lossy, false);
  const second = ring.read(first.nextOffset);
  assert.equal(second.output, "");
  assert.equal(second.nextOffset, first.nextOffset);
});

test("read from the middle slices the retained tail", () => {
  const ring = new OutputRing();
  ring.push("0123456789");
  const read = ring.read(4);
  assert.equal(read.output, "456789");
  assert.equal(read.nextOffset, 10);
  assert.equal(read.lossy, false);
});

test("reading past the end returns nothing new", () => {
  const ring = new OutputRing();
  ring.push("abc");
  const read = ring.read(100);
  assert.equal(read.output, "");
  assert.equal(read.nextOffset, 3);
});

test("invalid offsets read from the head when slid out", () => {
  const ring = new OutputRing(8);
  ring.push("0123456789"); // drops "01"
  const read = ring.read(0);
  assert.equal(read.lossy, true);
  assert.equal(read.output, "23456789");
  const valid = ring.read(2);
  assert.equal(valid.lossy, false);
  assert.equal(valid.output, "23456789");
});

test("the ring drops the oldest text beyond maxUnits", () => {
  const ring = new OutputRing(5);
  ring.push("abcdefghij");
  assert.equal(ring.length, 5);
  assert.equal(ring.read(0).output, "fghij");
  assert.equal(ring.head, 5);
  assert.equal(ring.total, 10);
});

test("empty pushes are ignored", () => {
  const ring = new OutputRing();
  ring.push("");
  assert.equal(ring.started, false);
  assert.equal(ring.read(0).output, "");
});

test("snapshot returns a bounded tail and a lossy flag", () => {
  const ring = new OutputRing();
  ring.push("abcdefghij");
  const snap = ring.snapshot(4);
  assert.equal(snap.output, "ghij");
  assert.equal(snap.nextOffset, 10);
  assert.equal(snap.lossy, true);
  // follow-up read from snapshot offset does not re-send
  assert.equal(ring.read(snap.nextOffset).output, "");
});

test("snapshot within the window is exact and not lossy", () => {
  const ring = new OutputRing();
  ring.push("abcdefghij");
  const snap = ring.snapshot(64);
  assert.equal(snap.output, "abcdefghij");
  assert.equal(snap.lossy, false);
});

test("constructor rejects invalid capacity", () => {
  assert.throws(() => new OutputRing(0), /positive safe integer/);
  assert.throws(() => new OutputRing(1.5), /positive safe integer/);
});
