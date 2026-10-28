import { beforeEach, describe, expect, it, vi } from "vitest";
import { synthesize } from "./tts.js";

type FakeWebSocketMessage = {
  data: ArrayBuffer | string;
};

type FakeWebSocketInit = {
  headers?: Record<string, string>;
};

const { FakeWebSocket } = vi.hoisted(() => {
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  binaryType: "arraybuffer" | "blob" = "blob";
  sentMessages: string[] = [];
  listeners = new Map<string, Map<(...args: unknown[]) => void, (event: Event) => void>>();

  constructor(
    public url: string,
    public init: FakeWebSocketInit,
  ) {
    super();
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  terminate() { this.close(); }

  on(type: string, callback: (...args: unknown[]) => void) {
    const wrapped = (event: Event) => {
      if (type === "message") {
        const data = (event as FakeWebSocketMessage & Event).data;
        callback(data, typeof data !== "string");
      } else if (type === "close") callback(1000, Buffer.alloc(0));
      else if (type === "error") callback(new Error("synthetic socket error"));
      else callback();
    };
    const byCallback = this.listeners.get(type) ?? new Map();
    byCallback.set(callback, wrapped); this.listeners.set(type, byCallback);
    this.addEventListener(type, wrapped);
    return this;
  }

  off(type: string, callback: (...args: unknown[]) => void) {
    const wrapped = this.listeners.get(type)?.get(callback);
    if (wrapped) this.removeEventListener(type, wrapped);
    this.listeners.get(type)?.delete(callback);
    return this;
  }

  send(message: string, callback?: (error?: Error) => void) {
    this.sentMessages.push(message);
    callback?.();
  }

  emitMessage(data: ArrayBuffer | string) {
    const event = new Event("message") as FakeWebSocketMessage & Event;
    Object.defineProperty(event, "data", { value: data });
    this.dispatchEvent(event);
  }
}
return { FakeWebSocket };
});

vi.mock("ws", () => ({ default: FakeWebSocket }));
vi.mock("../../shared/abuse-control.js", () => ({ authorizeProviderDispatch: vi.fn(async () => {}) }));

function createTtsConfig() {
  return {
    apiKey: "test-key",
    baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    model: "cosyvoice-v3-flash",
    provider: "dashscope",
    voiceLeft: "longxiaochun",
    voiceRight: "longcheng",
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.unstubAllGlobals();
});

describe("tts adapter", () => {
  it("synthesizes mp3 chunks through DashScope websocket", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const result = synthesize("今晚的信号", "longxiaochun", 0.95, {
      config: createTtsConfig(),
      retryDelayMs: 0,
      timeoutMs: 1000,
    });

    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    const socket = FakeWebSocket.instances[0];
    await vi.waitFor(() => {
      expect(socket.sentMessages).toHaveLength(1);
    });
    socket.emitMessage(
      JSON.stringify({
        header: {
          event: "task-started",
        },
      }),
    );
    await vi.waitFor(() => {
      expect(socket.sentMessages).toHaveLength(3);
    });
    const audioChunk = Buffer.from("mp3-left");
    socket.emitMessage(
      audioChunk.buffer.slice(
        audioChunk.byteOffset,
        audioChunk.byteOffset + audioChunk.byteLength,
      ),
    );
    socket.emitMessage(
      JSON.stringify({
        header: {
          event: "task-finished",
        },
      }),
    );

    await expect(result).resolves.toBeInstanceOf(Buffer);
    expect(socket.url).toBe("wss://dashscope.aliyuncs.com/api-ws/v1/inference");
    expect(socket.binaryType).toBe("arraybuffer");
    expect(socket.init.headers).toMatchObject({
      authorization: "Bearer test-key",
    });
    expect(JSON.parse(socket.sentMessages[0]) as object).toMatchObject({
      header: {
        action: "run-task",
      },
      payload: {
        function: "SpeechSynthesizer",
        model: "cosyvoice-v3-flash",
        parameters: {
          format: "mp3",
          sample_rate: 24000,
          voice: "longxiaochun",
        },
        task: "tts",
        task_group: "audio",
      },
    });
    expect(JSON.parse(socket.sentMessages[1]) as object).toMatchObject({
      header: {
        action: "continue-task",
      },
      payload: {
        input: {
          text: "今晚的信号",
        },
      },
    });
    expect(JSON.parse(socket.sentMessages[2]) as object).toMatchObject({
      header: {
        action: "finish-task",
      },
    });
  });

  it("logs provider task failure diagnostics without leaking the API key", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const result = synthesize("今晚的信号", "longxiaochun", 0.95, {
      config: createTtsConfig(),
      logger,
      retryDelayMs: 0,
      timeoutMs: 1000,
    });

    for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
      await vi.waitFor(() => {
        expect(FakeWebSocket.instances).toHaveLength(attemptIndex + 1);
      });
      const socket = FakeWebSocket.instances[attemptIndex];
      await vi.waitFor(() => {
        expect(socket.sentMessages).toHaveLength(1);
      });
      socket.emitMessage(
        JSON.stringify({
          header: {
            error_code: "InvalidParameter",
            error_message: "voice is invalid",
            event: "task-failed",
            task_id: `provider-task-${attemptIndex}`,
          },
        }),
      );
    }

    await expect(result).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      details: {
        boundary: "provider_call",
        kind: "provider_task_failed",
        type: "tts-synthesis",
      },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tts.provider.task_failed",
        providerErrorCode: "InvalidParameter",
        providerErrorMessage: "voice is invalid",
        providerEvent: "task-failed",
        providerTaskId: "provider-task-0",
      }),
      "tts provider task failed",
    );
    expect(
      logger.warn.mock.calls.some(([fields]) => {
        return (
          typeof fields === "object" &&
          fields !== null &&
          "failureBoundary" in fields &&
          (fields as Record<string, unknown>).failureBoundary === "provider_call" &&
          (fields as Record<string, unknown>).failureKind === "provider_task_failed" &&
          (fields as Record<string, unknown>).failureType === "tts-synthesis"
        );
      }),
    ).toBe(true);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("test-key");
  });

  it("reads base64 audio from nested payload output", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const result = synthesize("今晚的信号", "longhuhu_v3", 0.95, {
      config: createTtsConfig(),
      retryDelayMs: 0,
      timeoutMs: 1000,
    });

    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    const socket = FakeWebSocket.instances[0];
    await vi.waitFor(() => {
      expect(socket.sentMessages).toHaveLength(1);
    });
    socket.emitMessage(
      JSON.stringify({
        header: {
          event: "task-started",
        },
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        header: {
          event: "result-generated",
        },
        payload: {
          output: {
            audio: Buffer.from("mp3-nested").toString("base64"),
          },
        },
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        header: {
          event: "task-finished",
        },
      }),
    );

    await expect(result).resolves.toEqual(Buffer.from("mp3-nested"));
  });

  it("logs safe payload paths when provider finishes without readable audio", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const result = synthesize("今晚的信号", "longhuhu_v3", 0.95, {
      config: createTtsConfig(),
      logger,
      retryDelayMs: 0,
      timeoutMs: 1000,
    });

    for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
      await vi.waitFor(() => {
        expect(FakeWebSocket.instances).toHaveLength(attemptIndex + 1);
      });
      const socket = FakeWebSocket.instances[attemptIndex];
      await vi.waitFor(() => {
        expect(socket.sentMessages).toHaveLength(1);
      });
      socket.emitMessage(
        JSON.stringify({
          header: {
            event: "task-finished",
            task_id: `provider-task-${attemptIndex}`,
          },
          payload: {
            output: {
              audio_url: "https://example.invalid/audio.mp3",
            },
          },
        }),
      );
    }

    await expect(result).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      details: {
        boundary: "provider_call",
        kind: "invalid_response",
        type: "tts-synthesis",
      },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tts.provider.empty_audio",
        providerEvent: "task-finished",
        providerPayloadPaths: expect.arrayContaining([
          "header.event",
          "payload.output.audio_url",
        ]),
        providerTaskId: "provider-task-0",
      }),
      "tts provider finished without readable audio",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("今晚的信号");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("test-key");
  });

  it("does not retry or open a socket when the owner's dispatch check is uncertain", async () => {
    const beforeDispatch = vi.fn(async () => { throw new Error("SYNTHETIC_PRIVATE_DB_DETAIL"); });
    await expect(synthesize("合成音频", undefined, 1, { config: createTtsConfig(), beforeDispatch, retryDelayMs: 0 }))
      .rejects.toMatchObject({ code: "AI_UNAVAILABLE", details: { abuseRule: "concurrency", reason: "unavailable" } });
    expect(beforeDispatch).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("rejects unconfigured provider before opening websocket", async () => {
    const WebSocketMock = vi.fn();
    vi.stubGlobal("WebSocket", WebSocketMock);

    await expect(
      synthesize("今晚的信号", "longxiaochun", 0.95, {
        config: {
          ...createTtsConfig(),
          apiKey: "",
        },
      }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
    expect(WebSocketMock).not.toHaveBeenCalled();
  });
});
