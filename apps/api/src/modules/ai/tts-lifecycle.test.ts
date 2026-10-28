import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbuseControlStopped } from "../../shared/abuse-errors.js";
import { synthesize } from "./tts.js";

const { authorizeDispatch, resolveConfigs } = vi.hoisted(() => ({
  authorizeDispatch: vi.fn(async (_kind: string, _units?: number) => {}),
  resolveConfigs: vi.fn(async () => [] as Array<{
    apiKey: string; baseUrl: string; model: string; provider: string; voiceLeft: string; voiceRight: string;
  }>),
}));
vi.mock("../../shared/abuse-control.js", () => ({ authorizeProviderDispatch: authorizeDispatch }));
vi.mock("./provider-config.js", () => ({ resolveTtsProviderConfigs: resolveConfigs }));

type Peer = {
  socket: Socket;
  sendJson: (value: unknown) => void;
  sendBinary: (value: Buffer) => void;
  close: () => void;
};
type LocalBehavior = (message: { header?: { action?: string } }, peer: Peer, sequence: number) => void;
const ownedServers: Array<{ close: () => Promise<void> }> = [];

function frame(opcode: number, payload: Buffer): Buffer {
  let header: Buffer;
  if (payload.length < 126) header = Buffer.from([0x80 | opcode, payload.length]);
  else if (payload.length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

async function localProvider(behavior: LocalBehavior, options: { ignoreClose?: boolean; upgrade?: boolean; onUpgrade?: () => void } = {}) {
  const sockets = new Set<Socket>();
  const messages: Array<{ sequence: number; action: string }> = [];
  const authorizations: boolean[] = [];
  let attempts = 0;
  let closed = 0;
  let peerEnded = 0;
  const server = createServer();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => { sockets.delete(socket); closed += 1; });
    socket.on("error", () => {});
    socket.once("end", () => {
      // A raw HTTP-upgrade socket may retain a half-open writable side. This
      // observes actual client TCP EOF first, then ends only the fixture side;
      // it never acknowledges the deliberately ignored WebSocket close frame.
      peerEnded += 1;
      socket.end();
    });
  });
  server.on("upgrade", (request, socket) => {
    const sequence = ++attempts;
    authorizations.push(request.headers.authorization === "Bearer tts-local-synthetic");
    options.onUpgrade?.();
    if (options.upgrade === false) { socket.resume(); return; }
    const accept = createHash("sha1").update(`${String(request.headers["sec-websocket-key"])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const peer: Peer = {
      socket: socket as Socket,
      sendJson(value) { socket.write(frame(1, Buffer.from(JSON.stringify(value)))); },
      sendBinary(value) { socket.write(frame(2, value)); },
      close() { socket.end(frame(8, Buffer.from([0x03, 0xe8]))); },
    };
    let pending = Buffer.alloc(0);
    socket.on("data", (data: Buffer) => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= 2) {
        const opcode = pending[0] & 0x0f;
        const masked = (pending[1] & 0x80) !== 0;
        let size = pending[1] & 0x7f;
        let offset = 2;
        if (size === 126) {
          if (pending.length < 4) return;
          size = pending.readUInt16BE(2); offset = 4;
        } else if (size === 127) {
          if (pending.length < 10) return;
          const length = pending.readBigUInt64BE(2);
          if (length > 131072n) { socket.destroy(); return; }
          size = Number(length); offset = 10;
        }
        if (!masked || size > 131072) { socket.destroy(); return; }
        if (pending.length < offset + 4 + size) return;
        const mask = pending.subarray(offset, offset + 4);
        const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + size));
        for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
        pending = pending.subarray(offset + 4 + size);
        if (opcode === 8) {
          if (!options.ignoreClose) socket.end(frame(8, payload));
        } else if (opcode === 1) {
          const message = JSON.parse(payload.toString("utf8")) as { header?: { action?: string } };
          messages.push({ sequence, action: message.header?.action ?? "other" });
          behavior(message, peer, sequence);
        }
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Local TTS fixture did not bind.");
  const fixture = {
    config: { apiKey: "tts-local-synthetic", baseUrl: `ws://127.0.0.1:${address.port}`, model: "synthetic-model", provider: "local-test", voiceLeft: "left", voiceRight: "right" },
    messages, authorizations,
    get attempts() { return attempts; },
    get closed() { return closed; },
    get peerEnded() { return peerEnded; },
    get sockets() { return sockets.size; },
    async close() {
      const stopped = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      const closedSockets = [...sockets].map((socket) => new Promise<void>((resolve) => { socket.once("close", resolve); socket.destroy(); }));
      await Promise.all([stopped, ...closedSockets]);
    },
  };
  ownedServers.push(fixture);
  return fixture;
}

beforeEach(() => {
  authorizeDispatch.mockReset(); authorizeDispatch.mockResolvedValue(undefined);
  resolveConfigs.mockReset(); resolveConfigs.mockResolvedValue([]);
});
afterEach(async () => {
  await Promise.all(ownedServers.splice(0).map((server) => server.close()));
});

describe("TTS real local transport lifecycle", () => {
  it("sends the actual Authorization header and preserves normal binary synthesis", async () => {
    const provider = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") peer.sendJson({ header: { event: "task-started" } });
      if (message.header?.action === "finish-task") {
        peer.sendBinary(Buffer.from("real-local-mp3"));
        peer.sendJson({ header: { event: "task-finished" } });
      }
    });
    await expect(synthesize("synthetic text", undefined, 1, { config: provider.config, retryDelayMs: 0, timeoutMs: 500 }))
      .resolves.toEqual(Buffer.from("real-local-mp3"));
    expect(provider.authorizations).toEqual([true]);
    expect(authorizeDispatch).toHaveBeenCalledWith("tts", "synthetic text".length);
    expect(provider.messages.map((message) => message.action)).toEqual(["run-task", "continue-task", "finish-task"]);
  });

  it("rejects an early clean close instead of leaving synthesis permanently pending", async () => {
    const provider = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") peer.close();
    });
    let outcome = "pending";
    const work = synthesize("synthetic text", undefined, 1, { config: provider.config, retryDelayMs: 0, timeoutMs: 100 });
    void work.then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
    await expect.poll(() => outcome, { timeout: 700, interval: 10 }).toBe("rejected");
    await expect(work).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(provider.attempts).toBe(3);
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
  });

  it("sends text only once for duplicate task-started events", async () => {
    const provider = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") {
        peer.sendJson({ header: { event: "task-started" } });
        peer.sendJson({ header: { event: "task-started" } });
      }
      if (message.header?.action === "finish-task") {
        peer.sendBinary(Buffer.from("one-copy"));
        peer.sendJson({ header: { event: "task-finished" } });
      }
    });
    await expect(synthesize("synthetic text", undefined, 1, { config: provider.config, timeoutMs: 500 }))
      .resolves.toEqual(Buffer.from("one-copy"));
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
    expect(provider.messages.filter((message) => message.action === "continue-task")).toHaveLength(1);
    expect(provider.messages.filter((message) => message.action === "finish-task")).toHaveLength(1);
  });

  it("does not send text for queued messages after task failure", async () => {
    const provider = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") {
        peer.socket.write(Buffer.concat([
          frame(1, Buffer.from(JSON.stringify({ header: { event: "task-failed" } }))),
          frame(1, Buffer.from(JSON.stringify({ header: { event: "task-started" } }))),
        ]));
      }
    });
    await expect(synthesize("synthetic text", undefined, 1, { config: provider.config, retryDelayMs: 0, timeoutMs: 500 }))
      .rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
    expect(provider.attempts).toBe(3);
    expect(provider.messages.every((message) => message.action === "run-task")).toBe(true);
  });

  it.each(["binary", "base64"] as const)("bounds cumulative %s audio and closes every failed attempt", async (encoding) => {
    const provider = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") {
        if (encoding === "binary") {
          peer.sendBinary(Buffer.from("1234")); peer.sendBinary(Buffer.from("5678"));
        } else {
          peer.sendJson({ output: { audio: Buffer.from("1234").toString("base64") } });
          peer.sendJson({ payload: { output: { audio: Buffer.from("5678").toString("base64") } } });
        }
        peer.sendJson({ header: { event: "task-finished" } });
      }
    });
    const options = { config: provider.config, retryDelayMs: 0, timeoutMs: 500, maxAudioBytes: 6 };
    await expect(synthesize("synthetic text", undefined, 1, options)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
    expect(provider.attempts).toBe(3);
  });

  it("bounds a provider JSON frame before parsing it", async () => {
    const provider = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") {
        peer.sendJson({ padding: "x".repeat(1024 * 1024), output: { audio: Buffer.from("small").toString("base64") }, header: { event: "task-finished" } });
      }
    });
    await expect(synthesize("synthetic text", undefined, 1, { config: provider.config, retryDelayMs: 0, timeoutMs: 500 }))
      .rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
  });

  it("does not retain an audio chunk per empty or one-byte provider message", async () => {
    const concat = Buffer.concat;
    const assembledBlockCounts: number[] = [];
    const spy = vi.spyOn(Buffer, "concat").mockImplementation((list, totalLength) => {
      if (totalLength === 4096) assembledBlockCounts.push(list.length);
      return concat(list, totalLength);
    });
    try {
      const provider = await localProvider((message, peer) => {
        if (message.header?.action === "run-task") {
          const empty = frame(2, Buffer.alloc(0));
          const byte = frame(2, Buffer.from("a"));
          peer.socket.write(concat([
            ...Array.from({ length: 4096 }, () => empty),
            ...Array.from({ length: 4096 }, () => byte),
            frame(1, Buffer.from(JSON.stringify({ header: { event: "task-finished" } }))),
          ]));
        }
      });
      await expect(synthesize("synthetic text", undefined, 1, { config: provider.config, timeoutMs: 1000, maxAudioBytes: 4096 }))
        .resolves.toEqual(Buffer.alloc(4096, "a"));
      expect(assembledBlockCounts).toEqual([1]);
      await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it("waits for actual local socket closure when a peer ignores the close handshake", async () => {
    const provider = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") {
        peer.sendBinary(Buffer.from("bounded-close"));
        peer.sendJson({ header: { event: "task-finished" } });
      }
    }, { ignoreClose: true });
    const options = { config: provider.config, timeoutMs: 300, closeTimeoutMs: 30 };
    await expect(synthesize("synthetic text", undefined, 1, options)).resolves.toEqual(Buffer.from("bounded-close"));
    // This observes the peer's real TCP close; it does not infer cancellation
    // from a Promise timeout or terminate this socket from the server fixture.
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
    expect(provider.closed).toBe(1);
    expect(provider.peerEnded).toBe(1);
  });

  it("aborts an active request without retry and observes the actual peer socket ending", async () => {
    const controller = new AbortController();
    const provider = await localProvider((message) => {
      if (message.header?.action === "run-task") controller.abort();
    }, { ignoreClose: true });
    const options = { config: provider.config, signal: controller.signal, timeoutMs: 500, retryDelayMs: 0, closeTimeoutMs: 30 };
    await expect(synthesize("synthetic text", undefined, 1, options)).rejects.toMatchObject({ name: "AbortError" });
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
    expect(provider.attempts).toBe(1);
    expect(provider.peerEnded).toBe(1);
  });

  it("bounds all retries with one total deadline and closes the remaining socket", async () => {
    const provider = await localProvider(() => {}, { ignoreClose: true });
    const options = { config: provider.config, timeoutMs: 50, totalTimeoutMs: 120, retryDelayMs: 0, closeTimeoutMs: 10 };
    const started = Date.now();
    await expect(synthesize("synthetic text", undefined, 1, options)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE", details: { kind: "timeout", timeoutMs: 120 },
    });
    expect(Date.now() - started).toBeLessThan(500);
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
    expect(provider.attempts).toBeLessThanOrEqual(2);
    expect(provider.peerEnded).toBe(provider.attempts);
  });

  it("rejects an already aborted signal without opening a connection", async () => {
    const provider = await localProvider(() => {});
    const controller = new AbortController(); controller.abort();
    const options = { config: provider.config, signal: controller.signal, retryDelayMs: 0, timeoutMs: 30 };
    await expect(synthesize("synthetic text", undefined, 1, options)).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.attempts).toBe(0);
    expect(authorizeDispatch).not.toHaveBeenCalled();
  });

  it("terminates an aborted HTTP upgrade before it becomes a WebSocket", async () => {
    const controller = new AbortController();
    const provider = await localProvider(() => {}, { upgrade: false, onUpgrade: () => controller.abort() });
    await expect(synthesize("synthetic text", undefined, 1, {
      config: provider.config, signal: controller.signal, timeoutMs: 500, closeTimeoutMs: 30,
    })).rejects.toMatchObject({ name: "AbortError" });
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
    expect(provider.attempts).toBe(1);
    expect(provider.peerEnded).toBe(1);
  });

  it("observes client TCP close before rejecting an aborted upgrade", async () => {
    const controller = new AbortController();
    const provider = await localProvider(() => {}, { upgrade: false, onUpgrade: () => controller.abort() });
    const port = Number(new URL(provider.config.baseUrl).port);
    const connected = new Set<Socket>();
    const actuallyClosed = new Set<Socket>();
    const emit = Socket.prototype.emit;
    // Observe the real client net.Socket without replacing its transport,
    // destroy method, or event order. Server accepted sockets do not connect
    // to this endpoint's port and cannot satisfy this assertion.
    const spy = vi.spyOn(Socket.prototype, "emit").mockImplementation(function (this: Socket, event: string | symbol, ...args: unknown[]) {
      if (event === "connect" && this.remotePort === port) {
        connected.add(this);
        this.once("close", () => { actuallyClosed.add(this); });
      }
      return Reflect.apply(emit, this, [event, ...args]) as boolean;
    });
    try {
      await expect(synthesize("synthetic text", undefined, 1, {
        config: provider.config, signal: controller.signal, timeoutMs: 500, closeTimeoutMs: 30,
      })).rejects.toMatchObject({ name: "AbortError" });
      // No polling or fixture-side destruction can make this check pass after
      // the synthesis Promise has already settled too early.
      expect(connected.size).toBe(1);
      expect(actuallyClosed.size).toBe(connected.size);
    } finally { spy.mockRestore(); }
  });

  it("interrupts retry backoff without opening another connection", async () => {
    const controller = new AbortController();
    const provider = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") peer.sendJson({ header: { event: "task-failed" } });
    });
    let enteredBackoff = false;
    const logger = { info() {}, error() {}, warn(_fields: Record<string, unknown>, message: string) {
      if (message === "tts synthesis retrying") {
        enteredBackoff = true;
        // The microtask runs after the real retry sleep installs its abort
        // listener in the same stack, without guessing a wall-clock delay.
        queueMicrotask(() => controller.abort());
      }
    } };
    await expect(synthesize("synthetic text", undefined, 1, {
      config: provider.config, signal: controller.signal, retryDelayMs: 1000, timeoutMs: 500, logger,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(enteredBackoff).toBe(true);
    expect(provider.attempts).toBe(1);
    expect(authorizeDispatch).toHaveBeenCalledTimes(1);
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
  });

  it("charges every real retry and config fallback while preserving nested base64 output", async () => {
    const first = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") peer.sendJson({ header: { event: "task-failed" } });
    });
    const second = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") peer.sendJson({
        header: { event: "task-finished" }, payload: { output: { audio: Buffer.from("fallback-mp3").toString("base64") } },
      });
    });
    resolveConfigs.mockResolvedValue([first.config, second.config]);
    await expect(synthesize("  synthetic text  ", undefined, 1, { retryDelayMs: 0, timeoutMs: 500 }))
      .resolves.toEqual(Buffer.from("fallback-mp3"));
    expect(first.attempts).toBe(3); expect(second.attempts).toBe(1);
    expect(authorizeDispatch.mock.calls).toEqual(Array.from({ length: 4 }, () => ["tts", "synthetic text".length]));
    await expect.poll(() => first.sockets + second.sockets, { timeout: 500, interval: 10 }).toBe(0);
  });

  it.each(["limited", "unavailable"] as const)("never falls back after a %s shared budget decision", async (reason) => {
    const provider = await localProvider(() => {});
    resolveConfigs.mockResolvedValue([provider.config, provider.config]);
    const stopped = new AbuseControlStopped(reason, "concurrency", 1000);
    authorizeDispatch.mockRejectedValueOnce(stopped);
    await expect(synthesize("synthetic text", undefined, 1, { retryDelayMs: 0 })).rejects.toBe(stopped);
    expect(authorizeDispatch).toHaveBeenCalledTimes(1);
    expect(provider.attempts).toBe(0);
  });

  it("does not construct a second socket when the retry budget is denied", async () => {
    const provider = await localProvider((message, peer) => {
      if (message.header?.action === "run-task") peer.sendJson({ header: { event: "task-failed" } });
    });
    resolveConfigs.mockResolvedValue([provider.config, provider.config]);
    const stopped = new AbuseControlStopped("limited", "concurrency", 1000);
    authorizeDispatch.mockResolvedValueOnce(undefined).mockRejectedValueOnce(stopped);
    await expect(synthesize("synthetic text", undefined, 1, { retryDelayMs: 0 })).rejects.toBe(stopped);
    expect(authorizeDispatch).toHaveBeenCalledTimes(2);
    expect(provider.attempts).toBe(1);
    await expect.poll(() => provider.sockets, { timeout: 500, interval: 10 }).toBe(0);
  });

  it("never converts an AbortError from the dispatch boundary into fallback", async () => {
    const provider = await localProvider(() => {});
    resolveConfigs.mockResolvedValue([provider.config, provider.config]);
    const stopped = new DOMException("Synthetic dispatch stopped.", "AbortError");
    authorizeDispatch.mockRejectedValueOnce(stopped);
    await expect(synthesize("synthetic text", undefined, 1, { retryDelayMs: 0 })).rejects.toBe(stopped);
    expect(authorizeDispatch).toHaveBeenCalledTimes(1);
    expect(provider.attempts).toBe(0);
  });
});
