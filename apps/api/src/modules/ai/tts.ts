import { randomUUID } from "node:crypto";
import type { ClientRequest } from "node:http";
import type { Socket } from "node:net";
import { performance } from "node:perf_hooks";
import WebSocket, { type RawData } from "ws";
import { authorizeProviderDispatch } from "../../shared/abuse-control.js";
import { AbuseControlStopped } from "../../shared/abuse-errors.js";
import { AppError, toSafeAiFailureDetails } from "../../shared/errors.js";
import { resolveTtsProviderConfigs, type TtsProviderConfig } from "./provider-config.js";
import { isAbortError } from "./provider-errors.js";

const ttsTimeoutMs = 20_000;
const ttsMaxRetries = 2;
const defaultRetryDelayMs = 200;
const defaultTotalTimeoutMs = 120_000;
const defaultMaxAudioBytes = 16 * 1024 * 1024;
const defaultCloseTimeoutMs = 1000;
const maxProviderJsonBytes = 1024 * 1024;

export type TtsLogger = {
  error: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
};

export type SynthesizeOptions = {
  beforeDispatch?: () => Promise<void>;
  config?: TtsProviderConfig;
  logger?: TtsLogger;
  retryDelayMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
  maxAudioBytes?: number;
  closeTimeoutMs?: number;
};

type DashScopeEvent = {
  code?: string;
  event?: string;
  header?: {
    error_code?: string;
    error_message?: string;
    event?: string;
    task_id?: string;
  };
  message?: string;
  output?: {
    audio?: string;
    audio_url?: string;
    code?: string;
    error_code?: string;
    error_message?: string;
    message?: string;
    url?: string;
  };
  payload?: {
    output?: {
      audio?: string;
      audio_url?: string;
      url?: string;
    };
  };
};

async function getTtsConfigs(): Promise<TtsProviderConfig[]> {
  return resolveTtsProviderConfigs();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    };
    const aborted = () => { cleanup(); reject(signal?.reason); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

class TtsExecutionStopped extends AppError {
  constructor(totalTimeoutMs: number) {
    super("AI_UNAVAILABLE", "TTS synthesis deadline exceeded.", {
      boundary: "provider_call", kind: "timeout", timeoutMs: totalTimeoutMs, type: "tts-synthesis",
    });
    this.name = "TtsExecutionStopped";
  }
}

function executionLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new AppError("AI_UNAVAILABLE", "Invalid TTS execution limit.");
  }
  return value;
}

function synthesisExecution(options: SynthesizeOptions) {
  const totalTimeoutMs = executionLimit(options.totalTimeoutMs ?? defaultTotalTimeoutMs);
  const controller = new AbortController();
  const deadline = performance.now() + totalTimeoutMs;
  const deadlineError = new TtsExecutionStopped(totalTimeoutMs);
  const abortExternal = () => controller.abort(options.signal?.reason instanceof Error
    ? options.signal.reason : new DOMException("TTS synthesis aborted.", "AbortError"));
  const timer = setTimeout(() => controller.abort(deadlineError), totalTimeoutMs);
  options.signal?.addEventListener("abort", abortExternal, { once: true });
  if (options.signal?.aborted) abortExternal();
  const check = () => {
    if (!controller.signal.aborted && performance.now() >= deadline) controller.abort(deadlineError);
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  return {
    signal: controller.signal,
    check,
    remainingMs() { check(); return Math.max(1, Math.ceil(deadline - performance.now())); },
    dispose() { clearTimeout(timer); options.signal?.removeEventListener("abort", abortExternal); },
  };
}

function toErrorReason(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }

  if (error instanceof Error) {
    return error.name;
  }

  return "unknown";
}

function parseDashScopeEvent(data: string): DashScopeEvent | undefined {
  try {
    return JSON.parse(data) as DashScopeEvent;
  } catch {
    return undefined;
  }
}

function readDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue.slice(0, 500) : undefined;
}

function toDashScopeFailureFields(payload: DashScopeEvent | undefined): Record<string, unknown> {
  return {
    providerErrorCode:
      readDiagnosticText(payload?.header?.error_code) ??
      readDiagnosticText(payload?.output?.error_code) ??
      readDiagnosticText(payload?.output?.code) ??
      readDiagnosticText(payload?.code),
    providerErrorMessage:
      readDiagnosticText(payload?.header?.error_message) ??
      readDiagnosticText(payload?.output?.error_message) ??
      readDiagnosticText(payload?.output?.message) ??
      readDiagnosticText(payload?.message),
    providerEvent: readDiagnosticText(payload?.header?.event ?? payload?.event),
    providerTaskId: readDiagnosticText(payload?.header?.task_id),
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function collectPayloadPaths(value: unknown, prefix = ""): string[] {
  const paths: string[] = [];
  const pending = [{ value, prefix, depth: 0 }];
  while (pending.length > 0 && paths.length < 80) {
    const next = pending.pop()!;
    const record = readRecord(next.value);
    if (!record || next.depth >= 8) continue;
    for (const key of Object.keys(record).slice(0, 80)) {
      if (paths.length >= 80) break;
      const path = `${next.prefix}${next.prefix ? "." : ""}${key.slice(0, 80)}`;
      paths.push(path);
      if (readRecord(record[key])) pending.push({ value: record[key], prefix: path, depth: next.depth + 1 });
    }
  }
  return paths;
}

function readBase64AudioFields(payload: DashScopeEvent | undefined): string[] {
  return [
    payload?.output?.audio,
    payload?.payload?.output?.audio,
  ].flatMap((value) => {
    return typeof value === "string" && value.length > 0 ? [value] : [];
  });
}

function toDashScopePayloadShapeFields(
  payload: DashScopeEvent | undefined,
): Record<string, unknown> {
  return {
    providerEvent: readDiagnosticText(payload?.header?.event ?? payload?.event),
    providerPayloadPaths: collectPayloadPaths(payload).slice(0, 80),
    providerTaskId: readDiagnosticText(payload?.header?.task_id),
  };
}

function toSocketCloseFields(code: number, reason: Buffer): Record<string, unknown> {
  return {
    socketCloseCode: code,
    socketCloseReason: readDiagnosticText(reason.toString("utf8")),
  };
}

function readMessageData(data: RawData | string): Buffer | string | undefined {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  if (Array.isArray(data)) return Buffer.concat(data);

  return undefined;
}

function setSocketBinaryType(socket: WebSocket) {
  socket.binaryType = "arraybuffer";
}

function buildTaskHeader(action: "continue-task" | "finish-task" | "run-task", taskId: string) {
  return {
    action,
    streaming: "duplex",
    task_id: taskId,
  };
}

export async function isTtsProviderConfigured(config?: TtsProviderConfig): Promise<boolean> {
  const resolvedConfig = config ?? (await getTtsConfigs())[0];

  return (
    resolvedConfig !== undefined &&
    resolvedConfig.apiKey.length > 0 &&
    resolvedConfig.baseUrl.length > 0
  );
}

async function requestTts(params: {
  config: TtsProviderConfig;
  logger?: TtsLogger;
  speed: number;
  text: string;
  timeoutMs: number;
  closeTimeoutMs: number;
  maxAudioBytes: number;
  signal: AbortSignal;
  voice: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const taskId = randomUUID();
    const chunks: Buffer[] = [];
    let audioBytes = 0;
    let blockOffset = 0;
    let textSent = false;
    let settled = false;
    let closed = false;
    let socket: WebSocket | undefined;
    let request: ClientRequest | undefined;
    let requestClosed = true;
    const transports = new Set<Socket>();
    let timeout: NodeJS.Timeout | undefined;
    let closeTimeout: NodeJS.Timeout | undefined;
    let terminal: { ok: true; audio: Buffer } | { ok: false; error: unknown } | undefined;
    const failure = (message: string, kind: string) => new AppError("AI_UNAVAILABLE", message, {
      boundary: "provider_call", kind, type: "tts-synthesis",
    });
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(closeTimeout);
      params.signal.removeEventListener("abort", onAbort);
      socket?.off("open", onOpen);
      socket?.off("message", onMessage);
      socket?.off("error", onError);
      socket?.off("close", onClose);
      request?.off("socket", onTransport);
      request?.off("close", onRequestClose);
      for (const transport of transports) transport.off("close", onTransportClose);
    };
    const settleAfterClose = () => {
      if (settled || !closed || !requestClosed || transports.size > 0 || !terminal) return;
      settled = true;
      cleanup();
      if (terminal.ok) resolve(terminal.audio);
      else reject(terminal.error);
    };
    const onTransportClose = function (this: Socket) {
      transports.delete(this);
      settleAfterClose();
    };
    const onTransport = (transport: Socket) => {
      if (transports.has(transport)) return;
      transports.add(transport);
      transport.once("close", onTransportClose);
    };
    const onRequestClose = () => {
      requestClosed = true;
      settleAfterClose();
    };
    const terminateOwnedTransport = () => {
      socket?.terminate();
      if (request && !requestClosed) request.destroy();
      for (const transport of transports) transport.destroy();
    };
    const finish = (result: NonNullable<typeof terminal>) => {
      if (terminal) return;
      terminal = result;
      clearTimeout(timeout);
      // Stop all protocol work immediately. Keep error/close handlers until
      // the owned transport has actually ended, including a failed handshake.
      socket?.off("open", onOpen);
      socket?.off("message", onMessage);
      if (closed) {
        settleAfterClose();
        return;
      }
      if (!socket) {
        closed = true;
        terminateOwnedTransport();
        settleAfterClose();
        return;
      }
      closeTimeout = setTimeout(() => {
        // terminate() starts real socket destruction. It is not a substitute
        // for observing close: only onClose below can settle this attempt.
        terminateOwnedTransport();
      }, params.closeTimeoutMs);
      if (socket.readyState === WebSocket.CONNECTING) terminateOwnedTransport();
      else {
        try { socket.close(); }
        catch { terminateOwnedTransport(); }
      }
    };
    const fail = (error: unknown) => finish({ ok: false, error });
    const onAbort = () => fail(params.signal.reason);
    const send = (value: unknown) => {
      if (terminal || !socket) return;
      if (socket.readyState !== WebSocket.OPEN) {
        fail(failure("TTS provider unavailable.", "network_error"));
        return;
      }
      socket.send(JSON.stringify(value), (error) => {
        if (error) fail(failure("TTS provider unavailable.", "network_error"));
      });
    };
    const appendAudio = (chunk: Buffer) => {
      if (chunk.byteLength === 0) return true;
      if (chunk.byteLength > params.maxAudioBytes - audioBytes) {
        fail(failure("TTS provider audio exceeded its size limit.", "invalid_response"));
        return false;
      }
      // Provider messages may be empty or one byte long. Keep owned fixed-size
      // blocks rather than retaining one Buffer/object for every message.
      let sourceOffset = 0;
      while (sourceOffset < chunk.byteLength) {
        let block = chunks.at(-1);
        if (!block || blockOffset === block.byteLength) {
          block = Buffer.allocUnsafe(Math.min(64 * 1024, params.maxAudioBytes - audioBytes - sourceOffset));
          chunks.push(block);
          blockOffset = 0;
        }
        const copied = chunk.copy(block, blockOffset, sourceOffset);
        blockOffset += copied;
        sourceOffset += copied;
      }
      audioBytes += chunk.byteLength;
      return true;
    };
    const onOpen = () => {
      if (terminal) return;
      if (params.signal.aborted) { onAbort(); return; }
      send({
        header: buildTaskHeader("run-task", taskId),
        payload: {
          input: {},
          parameters: {
            enable_ssml: false, format: "mp3", pitch: 1, rate: params.speed,
            sample_rate: 24000, text_type: "PlainText", volume: 50, voice: params.voice,
          },
          function: "SpeechSynthesizer", model: params.config.model, task_group: "audio", task: "tts",
        },
      });
    };
    const onMessage = (raw: RawData, isBinary: boolean) => {
      if (terminal) return;
      if (params.signal.aborted) { onAbort(); return; }
      try {
        const data = readMessageData(raw);
        if (data === undefined) return;
        if (isBinary) {
          appendAudio(typeof data === "string" ? Buffer.from(data) : data);
          return;
        }
        if (Buffer.byteLength(data) > maxProviderJsonBytes) {
          fail(failure("TTS provider JSON exceeded its size limit.", "invalid_response"));
          return;
        }
        const payload = parseDashScopeEvent(typeof data === "string" ? data : data.toString("utf8"));
        const eventName = payload?.header?.event ?? payload?.event;
        if (eventName === "task-started") {
          if (textSent) return;
          textSent = true;
          send({ header: buildTaskHeader("continue-task", taskId), payload: { input: { text: params.text } } });
          send({ header: buildTaskHeader("finish-task", taskId), payload: { input: {} } });
          return;
        }
        if (eventName !== undefined && eventName !== "task-finished" && (
          payload?.header?.error_code !== undefined || payload?.header?.error_message !== undefined ||
          payload?.output?.code !== undefined || payload?.output?.error_code !== undefined ||
          payload?.output?.error_message !== undefined || payload?.output?.message !== undefined ||
          payload?.code !== undefined || payload?.message !== undefined
        )) {
          params.logger?.warn({
            action: "tts.provider.message", model: params.config.model, provider: params.config.provider,
            taskId, voice: params.voice, ...toDashScopeFailureFields(payload),
          }, "tts provider diagnostic message");
        }
        for (const audioBase64 of readBase64AudioFields(payload)) {
          // Check the decoded size before allocating a second copy of it.
          if (Buffer.byteLength(audioBase64, "base64") > params.maxAudioBytes - audioBytes ||
              !appendAudio(Buffer.from(audioBase64, "base64"))) {
            fail(failure("TTS provider audio exceeded its size limit.", "invalid_response"));
            return;
          }
        }
        if (eventName === "task-finished") {
          if (audioBytes === 0) {
            params.logger?.warn({
              action: "tts.provider.empty_audio", model: params.config.model, provider: params.config.provider,
              taskId, voice: params.voice, ...toDashScopePayloadShapeFields(payload),
            }, "tts provider finished without readable audio");
            fail(failure("TTS provider returned empty audio.", "invalid_response"));
          } else finish({ ok: true, audio: Buffer.concat(chunks, audioBytes) });
          return;
        }
        if (eventName === "task-failed") {
          params.logger?.warn({
            action: "tts.provider.task_failed", model: params.config.model, provider: params.config.provider,
            taskId, voice: params.voice, ...toDashScopeFailureFields(payload),
          }, "tts provider task failed");
          fail(failure("TTS provider failed.", "provider_task_failed"));
        }
      } catch {
        fail(failure("TTS provider returned an invalid response.", "invalid_response"));
      }
    };
    const onError = () => {
      if (terminal) return;
      params.logger?.warn({
        action: "tts.provider.socket_error", model: params.config.model, provider: params.config.provider,
        taskId, voice: params.voice, socketErrorType: "error",
      }, "tts provider websocket error");
      fail(failure("TTS provider unavailable.", "network_error"));
    };
    const onClose = (code: number, reason: Buffer) => {
      closed = true;
      if (!terminal) {
        params.logger?.warn({
          action: "tts.provider.socket_closed", model: params.config.model, provider: params.config.provider,
          taskId, voice: params.voice, ...toSocketCloseFields(code, reason),
        }, "tts provider websocket closed before completion");
        fail(failure("TTS provider closed before completion.", "premature_close"));
      } else settleAfterClose();
    };
    try {
      socket = new WebSocket(params.config.baseUrl, {
        headers: { authorization: `Bearer ${params.config.apiKey}`, "x-dashscope-datainspection": "enable" },
        maxPayload: Math.max(params.maxAudioBytes, maxProviderJsonBytes),
        perMessageDeflate: false,
        followRedirects: false,
        finishRequest(ownedRequest) {
          // During an aborted handshake ws can emit its own close on nextTick
          // before TCP close. Track public HTTP/socket lifecycle separately.
          request = ownedRequest;
          requestClosed = false;
          ownedRequest.once("close", onRequestClose);
          ownedRequest.once("socket", onTransport);
          if (ownedRequest.socket) {
            ownedRequest.off("socket", onTransport);
            onTransport(ownedRequest.socket);
          }
          ownedRequest.end();
        },
      });
      setSocketBinaryType(socket);
      socket.on("open", onOpen);
      socket.on("message", onMessage);
      socket.on("error", onError);
      socket.on("close", onClose);
      timeout = setTimeout(() => fail(new AppError("AI_UNAVAILABLE", "TTS provider timed out.", {
        boundary: "provider_call", kind: "timeout", timeoutMs: params.timeoutMs, type: "tts-synthesis",
      })), params.timeoutMs);
      params.signal.addEventListener("abort", onAbort, { once: true });
      if (params.signal.aborted) onAbort();
    } catch {
      fail(failure("TTS provider unavailable.", "network_error"));
    }
  });
}

export async function synthesize(
  text: string,
  voice: string | undefined,
  speed: number,
  options: SynthesizeOptions = {},
): Promise<Buffer> {
  const compactText = text.trim();
  if (compactText.length === 0) throw new AppError("AI_UNAVAILABLE", "TTS input is empty.");
  const timeoutMs = executionLimit(options.timeoutMs ?? ttsTimeoutMs);
  const maxAudioBytes = executionLimit(options.maxAudioBytes ?? defaultMaxAudioBytes);
  const closeTimeoutMs = executionLimit(options.closeTimeoutMs ?? defaultCloseTimeoutMs);
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 2_147_483_647) {
    throw new AppError("AI_UNAVAILABLE", "Invalid TTS retry delay.");
  }
  const execution = synthesisExecution(options);
  const maxAttempts = ttsMaxRetries + 1;
  try {
    execution.check();
    // A shared configuration read or budget reservation must actually settle.
    // The caller owns cancellation/closure of those shared resources; do not
    // race them and falsely report that their background I/O was cancelled.
    const configs = options.config === undefined ? await getTtsConfigs() : [options.config];
    execution.check();
    let lastError: unknown;
    for (const [configIndex, config] of configs.entries()) {
      execution.check();
      const resolvedVoice = voice ?? config.voiceLeft;
      const configured = await isTtsProviderConfigured(config);
      execution.check();
      if (!configured) {
        lastError = new AppError("AI_UNAVAILABLE", "TTS provider is not configured.");
        continue;
      }
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        execution.check();
        const startedAt = Date.now();
        try {
          options.logger?.info({
            action: "tts.synthesize", attempt, configIndex, model: config.model,
            provider: config.provider, voice: resolvedVoice,
          }, "tts synthesis started");
          await authorizeProviderDispatch("tts", compactText.length);
          execution.check();
          if (options.beforeDispatch) {
            try { await options.beforeDispatch(); }
            catch (error) {
              if (error instanceof AbuseControlStopped || isAbortError(error)) throw error;
              throw new AbuseControlStopped("unavailable", "concurrency");
            }
          }
          execution.check();
          const audio = await requestTts({
            config, logger: options.logger, speed, text: compactText,
            timeoutMs: Math.min(timeoutMs, execution.remainingMs()),
            closeTimeoutMs, maxAudioBytes, signal: execution.signal, voice: resolvedVoice,
          });
          execution.check();
          options.logger?.info({
            action: "tts.synthesize", attempts: attempt, configIndex,
            durationMs: Date.now() - startedAt, model: config.model,
            provider: config.provider, sizeBytes: audio.byteLength, voice: resolvedVoice,
          }, "tts synthesis completed");
          return audio;
        } catch (error) {
          // A control decision never becomes a retry or a different provider.
          if (error instanceof AbuseControlStopped || error instanceof TtsExecutionStopped || isAbortError(error)) throw error;
          execution.check();
          lastError = error;
          const fields = {
            action: "tts.synthesize", attempt, configIndex,
            durationMs: Date.now() - startedAt, maxAttempts, model: config.model,
            provider: config.provider,
            ...(error instanceof AppError ? toSafeAiFailureDetails(error.details) ?? {} : {}),
            reason: toErrorReason(error), voice: resolvedVoice,
          };
          if (attempt < maxAttempts) {
            options.logger?.warn(fields, "tts synthesis retrying");
            await sleep(Math.min(retryDelayMs, execution.remainingMs()), execution.signal);
            execution.check();
          } else options.logger?.error(fields, "tts synthesis failed");
        }
      }
    }
    execution.check();
    if (lastError instanceof AppError) throw lastError;
    throw new AppError("AI_UNAVAILABLE", "TTS provider unavailable.");
  } finally {
    execution.dispose();
  }
}
