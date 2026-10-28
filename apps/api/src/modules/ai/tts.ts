import { randomUUID } from "node:crypto";
import { AppError, toSafeAiFailureDetails } from "../../shared/errors.js";
import { resolveTtsProviderConfigs, type TtsProviderConfig } from "./provider-config.js";

const ttsTimeoutMs = 20_000;
const ttsMaxRetries = 2;
const defaultRetryDelayMs = 200;

export type TtsLogger = {
  error: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
};

type SynthesizeOptions = {
  config?: TtsProviderConfig;
  logger?: TtsLogger;
  retryDelayMs?: number;
  timeoutMs?: number;
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

type WebSocketCloseEvent = Event & {
  code?: unknown;
  reason?: unknown;
  wasClean?: unknown;
};

async function getTtsConfigs(): Promise<TtsProviderConfig[]> {
  return resolveTtsProviderConfigs();
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  const record = readRecord(value);

  if (record === undefined) {
    return [];
  }

  return Object.keys(record)
    .sort()
    .flatMap((key) => {
      const nextPrefix = prefix.length > 0 ? `${prefix}.${key}` : key;
      const childRecord = readRecord(record[key]);

      return childRecord === undefined
        ? [nextPrefix]
        : [nextPrefix, ...collectPayloadPaths(childRecord, nextPrefix)];
    });
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

function toSocketCloseFields(event: Event): Record<string, unknown> {
  const closeEvent = event as WebSocketCloseEvent;

  return {
    socketCloseCode:
      typeof closeEvent.code === "number" && Number.isFinite(closeEvent.code)
        ? closeEvent.code
        : undefined,
    socketCloseReason: readDiagnosticText(closeEvent.reason),
    socketCloseWasClean:
      typeof closeEvent.wasClean === "boolean" ? closeEvent.wasClean : undefined,
  };
}

function readMessageData(data: MessageEvent["data"]): Buffer | string | undefined {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

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
  voice: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const taskId = randomUUID();
    const chunks: Buffer[] = [];
    let settled = false;
    const socket = new WebSocket(params.config.baseUrl, {
      headers: {
        authorization: `Bearer ${params.config.apiKey}`,
        "x-dashscope-datainspection": "enable",
      },
    });
    setSocketBinaryType(socket);
    const timeout = setTimeout(() => {
      socket.close();
      fail(
        new AppError("AI_UNAVAILABLE", "TTS provider timed out.", {
          boundary: "provider_call",
          kind: "timeout",
          timeoutMs: params.timeoutMs,
          type: "tts-synthesis",
        }),
      );
    }, params.timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
    };

    const fail = (error: AppError) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const complete = (audio: Buffer) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(audio);
    };

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          header: buildTaskHeader("run-task", taskId),
          payload: {
            input: {},
            parameters: {
              enable_ssml: false,
              format: "mp3",
              pitch: 1,
              rate: params.speed,
              sample_rate: 24000,
              text_type: "PlainText",
              volume: 50,
              voice: params.voice,
            },
            function: "SpeechSynthesizer",
            model: params.config.model,
            task_group: "audio",
            task: "tts",
          },
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      const data = readMessageData(event.data);

      if (data === undefined) {
        return;
      }

      if (Buffer.isBuffer(data)) {
        chunks.push(data);
        return;
      }

      const payload = parseDashScopeEvent(data);
      const eventName = payload?.header?.event ?? payload?.event;

      if (eventName === "task-started") {
        socket.send(
          JSON.stringify({
            header: buildTaskHeader("continue-task", taskId),
            payload: {
              input: {
                text: params.text,
              },
            },
          }),
        );
        socket.send(
          JSON.stringify({
            header: buildTaskHeader("finish-task", taskId),
            payload: {
              input: {},
            },
          }),
        );
        return;
      }

      if (
        eventName !== undefined &&
        eventName !== "task-started" &&
        eventName !== "task-finished" &&
        (payload?.header?.error_code !== undefined ||
          payload?.header?.error_message !== undefined ||
          payload?.output?.code !== undefined ||
          payload?.output?.error_code !== undefined ||
          payload?.output?.error_message !== undefined ||
          payload?.output?.message !== undefined ||
          payload?.code !== undefined ||
          payload?.message !== undefined)
      ) {
        params.logger?.warn(
          {
            action: "tts.provider.message",
            model: params.config.model,
            provider: params.config.provider,
            taskId,
            voice: params.voice,
            ...toDashScopeFailureFields(payload),
          },
          "tts provider diagnostic message",
        );
      }

      for (const audioBase64 of readBase64AudioFields(payload)) {
        chunks.push(Buffer.from(audioBase64, "base64"));
      }

      if (eventName === "task-finished") {
        if (chunks.length === 0) {
          params.logger?.warn(
            {
              action: "tts.provider.empty_audio",
              model: params.config.model,
              provider: params.config.provider,
              taskId,
              voice: params.voice,
              ...toDashScopePayloadShapeFields(payload),
            },
            "tts provider finished without readable audio",
          );
          fail(
            new AppError("AI_UNAVAILABLE", "TTS provider returned empty audio.", {
              boundary: "provider_call",
              kind: "invalid_response",
              type: "tts-synthesis",
            }),
          );
          return;
        }

        complete(Buffer.concat(chunks));
        socket.close();
      }

      if (eventName === "task-failed") {
        params.logger?.warn(
          {
            action: "tts.provider.task_failed",
            model: params.config.model,
            provider: params.config.provider,
            taskId,
            voice: params.voice,
            ...toDashScopeFailureFields(payload),
          },
          "tts provider task failed",
        );
        fail(
          new AppError("AI_UNAVAILABLE", "TTS provider failed.", {
            boundary: "provider_call",
            kind: "provider_task_failed",
            type: "tts-synthesis",
          }),
        );
        socket.close();
      }
    });

    socket.addEventListener("error", (event) => {
      params.logger?.warn(
        {
          action: "tts.provider.socket_error",
          model: params.config.model,
          provider: params.config.provider,
          taskId,
          voice: params.voice,
          socketErrorType: event.type,
        },
        "tts provider websocket error",
      );
      fail(
        new AppError("AI_UNAVAILABLE", "TTS provider unavailable.", {
          boundary: "provider_call",
          kind: "network_error",
          type: "tts-synthesis",
        }),
      );
    });

    socket.addEventListener("close", (event) => {
      cleanup();

      if (!settled) {
        params.logger?.warn(
          {
            action: "tts.provider.socket_closed",
            model: params.config.model,
            provider: params.config.provider,
            taskId,
            voice: params.voice,
            ...toSocketCloseFields(event),
          },
          "tts provider websocket closed before completion",
        );
      }
    });
  });
}

export async function synthesize(
  text: string,
  voice: string | undefined,
  speed: number,
  options: SynthesizeOptions = {},
): Promise<Buffer> {
  const compactText = text.trim();
  const configs = options.config === undefined ? await getTtsConfigs() : [options.config];
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  const timeoutMs = options.timeoutMs ?? ttsTimeoutMs;
  const maxAttempts = ttsMaxRetries + 1;

  if (compactText.length === 0) {
    throw new AppError("AI_UNAVAILABLE", "TTS input is empty.");
  }

  let lastError: unknown;

  for (const [configIndex, config] of configs.entries()) {
    const resolvedVoice = voice ?? config.voiceLeft;

    if (!(await isTtsProviderConfigured(config))) {
      lastError = new AppError("AI_UNAVAILABLE", "TTS provider is not configured.");
      continue;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();

      try {
        options.logger?.info(
          {
            action: "tts.synthesize",
            attempt,
            configIndex,
            model: config.model,
            provider: config.provider,
            voice: resolvedVoice,
          },
          "tts synthesis started",
        );

        const audio = await requestTts({
          config,
          logger: options.logger,
          speed,
          text: compactText,
          timeoutMs,
          voice: resolvedVoice,
        });

        options.logger?.info(
          {
            action: "tts.synthesize",
            attempts: attempt,
            configIndex,
            durationMs: Date.now() - startedAt,
            model: config.model,
            provider: config.provider,
            sizeBytes: audio.byteLength,
            voice: resolvedVoice,
          },
          "tts synthesis completed",
        );

        return audio;
      } catch (error) {
        lastError = error;

        const fields = {
          action: "tts.synthesize",
          attempt,
          configIndex,
          durationMs: Date.now() - startedAt,
          maxAttempts,
          model: config.model,
          provider: config.provider,
          ...(error instanceof AppError
            ? toSafeAiFailureDetails(error.details) ?? {}
            : {}),
          reason: toErrorReason(error),
          voice: resolvedVoice,
        };

        if (attempt < maxAttempts) {
          options.logger?.warn(fields, "tts synthesis retrying");
          await sleep(retryDelayMs);
        } else {
          options.logger?.error(fields, "tts synthesis failed");
        }
      }
    }
  }

  if (lastError instanceof AppError) {
    throw lastError;
  }

  throw new AppError("AI_UNAVAILABLE", "TTS provider unavailable.");
}
