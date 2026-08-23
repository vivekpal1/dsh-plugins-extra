/**
 * Bounded terminal-output ring buffer shared by the PTY backends.
 *
 * Terminal output is appended as UTF-8-decoded strings (the node-pty and
 * subprocess transports both deliver decoded text). Offsets are whole-string
 * code-unit positions so a reader can resume from the exact `nextOffset` a
 * previous read returned, even across terminal reconnects; when the retained
 * window slides past the requested offset the read reports `lossy: true` and
 * returns the whole retained tail instead of a hole.
 */
export class OutputRing {
  /** Maximum retained code units; the oldest text is dropped beyond this. */
  #maxUnits;
  /** Retained text tail. */
  #text = "";
  /** Code units dropped from the front of `#text` (absolute stream position of `#text[0]`). */
  #head = 0;
  /** Total code units ever appended (absolute stream length). */
  #total = 0;

  constructor(maxUnits = 1048576) {
    if (!Number.isSafeInteger(maxUnits) || maxUnits <= 0) throw new Error("OutputRing maxUnits must be a positive safe integer");
    this.#maxUnits = maxUnits;
  }

  /** Append one decoded text chunk. Empty chunks are ignored. */
  push(value) {
    if (value.length === 0) return;
    this.#text += value;
    this.#total += value.length;
    if (this.#text.length > this.#maxUnits) {
      const drop = this.#text.length - this.#maxUnits;
      this.#text = this.#text.slice(drop);
      this.#head += drop;
    }
  }

  /** Absolute stream position of the next byte/unit to be appended. */
  get total() {
    return this.#total;
  }

  /** Absolute stream position of the first retained unit (0 until text drops). */
  get head() {
    return this.#head;
  }

  /** Retained code units. */
  get length() {
    return this.#text.length;
  }

  /**
   * Read text appended since an absolute offset.
   * @param fromOffset - absolute code-unit offset (a prior read's `nextOffset`, or `total` for "nothing new").
   * @returns the delta text, the next resume offset, and `lossy` when the requested offset slid out of the window.
   */
  read(fromOffset) {
    const nextOffset = this.#total;
    if (!Number.isFinite(fromOffset) || fromOffset >= nextOffset) return { output: "", nextOffset, lossy: false };
    if (fromOffset < this.#head) return { output: this.#text, nextOffset, lossy: true };
    return { output: this.#text.slice(fromOffset - this.#head), nextOffset, lossy: false };
  }

  /**
   * Replay a bounded tail for a reconnecting reader (tab switch / reconnect).
   * `nextOffset` is set to the full stream length so a follow-up `read` never
   * re-sends the replayed text.
   */
  snapshot(maxUnits = 65536) {
    const nextOffset = this.#total;
    if (this.#text.length <= maxUnits) return { output: this.#text, nextOffset, lossy: this.#head > 0 };
    return { output: this.#text.slice(-maxUnits), nextOffset, lossy: true };
  }

  /** True once any text has been appended. */
  get started() {
    return this.#total > 0;
  }
}
