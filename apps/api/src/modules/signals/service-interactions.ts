import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import type { EmbeddingLogger } from "../ai/embedding.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { CreateSignalEchoBody, SignalResonanceBody } from "./schemas.js";
import {
  createSignalEcho,
  createSignalEchoForPersona,
  createSignalResonance,
  createSignalResonanceForPersona,
  createSignalSave,
  deleteSignalResonance,
  deleteSignalSave,
  findPublishedSignalById,
  listPublishedSignalEchoes,
  SignalNotFoundForInteraction,
} from "./repository.js";
import {
  aiInteractionDevelopmentInitialDelayMs,
  aiInteractionDevelopmentWindowMs,
  aiInteractionMaxEchoes,
  aiInteractionMaxResonances,
  aiInteractionMinEchoes,
  aiInteractionMinResonances,
  aiInteractionProductionInitialDelayMs,
  aiInteractionProductionWindowMs,
} from "./service-constants.js";
import { toSafeErrorReason } from "./service-errors.js";
import {
  getSignalFrequencyProfile,
  toShortText,
  toSignalEchoDetail,
} from "./service-mappers.js";
import {
  pickPersonas,
  randomInt,
  toPersonaGuestKey,
} from "./service-personas.js";
import type {
  SignalDetail,
  SignalEchoDetail,
  SignalInteractionSummary,
  SignalPersona,
  SignalRecord,
  SignalResonanceResult,
  SignalSaveResult,
} from "./types.js";

const scheduledInteractionSignalIds = new Set<string>();

function toSignalResonanceActor(
  frequency: AuthenticatedFrequency | undefined,
  _body: SignalResonanceBody,
): { actorKey: string; authorId?: string; frequencyId?: string; guestKey?: string } {
  if (frequency !== undefined) {
    if (frequency.status !== "ACTIVE") {
      throw new AppError("FORBIDDEN", "This frequency cannot resonate now.");
    }

    return {
      actorKey: `user:${frequency.id}`,
      authorId: frequency.id,
      frequencyId: frequency.id,
    };
  }

  throw new AppError("UNAUTHORIZED", "Frequency login required.");
}

export async function getSignalEchoes(signalId: string): Promise<SignalEchoDetail[]> {
  const signal = await findPublishedSignalById(signalId);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  const echoes = await listPublishedSignalEchoes(signalId);

  return echoes.map(toSignalEchoDetail);
}

export async function addSignalEcho(
  signalId: string,
  frequency: AuthenticatedFrequency | undefined,
  body: CreateSignalEchoBody,
): Promise<SignalEchoDetail> {
  if (frequency === undefined) {
    throw new AppError("UNAUTHORIZED", "Frequency login required.");
  }

  if (frequency !== undefined && frequency.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "This frequency cannot echo now.");
  }

  try {
    return toSignalEchoDetail(
      await createSignalEcho({
        authorId: frequency.id,
        content: body.content,
        signalId,
      }),
    );
  } catch (error) {
    if (error instanceof SignalNotFoundForInteraction) {
      throw new AppError("NOT_FOUND", "Signal not found.");
    }

    throw error;
  }
}

export async function addSignalResonance(
  signalId: string,
  frequency: AuthenticatedFrequency | undefined,
  body: SignalResonanceBody,
): Promise<SignalResonanceResult> {
  const actor = toSignalResonanceActor(frequency, body);

  try {
    return await createSignalResonance({
      actorKey: actor.actorKey,
      authorId: actor.authorId,
      frequencyId: actor.frequencyId,
      guestKey: actor.guestKey,
      signalId,
    });
  } catch (error) {
    if (error instanceof SignalNotFoundForInteraction) {
      throw new AppError("NOT_FOUND", "Signal not found.");
    }

    throw error;
  }
}

export async function removeSignalResonance(
  signalId: string,
  frequency: AuthenticatedFrequency | undefined,
  body: SignalResonanceBody,
): Promise<SignalResonanceResult> {
  const actor = toSignalResonanceActor(frequency, body);

  try {
    return await deleteSignalResonance({
      actorKey: actor.actorKey,
      signalId,
    });
  } catch (error) {
    if (error instanceof SignalNotFoundForInteraction) {
      throw new AppError("NOT_FOUND", "Signal not found.");
    }

    throw error;
  }
}

export async function addSignalSave(
  signalId: string,
  frequency: AuthenticatedFrequency | undefined,
): Promise<SignalSaveResult> {
  if (frequency === undefined) {
    throw new AppError("UNAUTHORIZED", "Frequency login required.");
  }

  if (frequency.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "This frequency cannot save signals now.");
  }

  try {
    return await createSignalSave({
      frequencyId: frequency.id,
      signalId,
    });
  } catch (error) {
    if (error instanceof SignalNotFoundForInteraction) {
      throw new AppError("NOT_FOUND", "Signal not found.");
    }

    throw error;
  }
}

export async function removeSignalSave(
  signalId: string,
  frequency: AuthenticatedFrequency | undefined,
): Promise<SignalSaveResult> {
  if (frequency === undefined) {
    throw new AppError("UNAUTHORIZED", "Frequency login required.");
  }

  return deleteSignalSave({
    frequencyId: frequency.id,
    signalId,
  });
}

type ScheduledSignalInteraction = {
  delayMs: number;
  persona: SignalPersona;
  shouldEcho: boolean;
};

function toStableOffset(value: string): number {
  return Array.from(value).reduce((total, character) => {
    return total + character.charCodeAt(0);
  }, 0);
}

function getInteractionTimingWindow() {
  if (env.isProduction) {
    return {
      initialDelayMs: aiInteractionProductionInitialDelayMs,
      windowMs: aiInteractionProductionWindowMs,
    };
  }

  return {
    initialDelayMs: aiInteractionDevelopmentInitialDelayMs,
    windowMs: aiInteractionDevelopmentWindowMs,
  };
}

function buildInteractionDelayMs(index: number, total: number): number {
  const timing = getInteractionTimingWindow();

  if (total <= 1) {
    return timing.initialDelayMs;
  }

  const ratio = index / (total - 1);
  const curve = (1 - Math.exp(-3 * ratio)) / (1 - Math.exp(-3));
  const spreadMs = Math.max(timing.windowMs - timing.initialDelayMs, 0);

  return Math.floor(timing.initialDelayMs + spreadMs * curve);
}

function buildScheduledSignalInteractions(signalId: string): ScheduledSignalInteraction[] {
  const resonancePersonas = pickPersonas(
    randomInt(aiInteractionMinResonances, aiInteractionMaxResonances),
    toStableOffset(signalId),
  );
  const echoGuestKeys = new Set(
    resonancePersonas
      .slice(0, randomInt(aiInteractionMinEchoes, aiInteractionMaxEchoes))
      .map(toPersonaGuestKey),
  );

  return resonancePersonas.map((persona, index) => {
    return {
      delayMs: buildInteractionDelayMs(index, resonancePersonas.length),
      persona,
      shouldEcho: echoGuestKeys.has(toPersonaGuestKey(persona)),
    };
  });
}

function buildPersonaEcho(params: {
  persona: SignalPersona;
  signal: SignalRecord;
}): string {
  const profile = getSignalFrequencyProfile(params.signal);
  const base = `我是${params.persona.fmName}，听见你靠近${profile.displayText}。${profile.coreNeed}这部分让我停了一下，我也有过类似的时刻。`;

  return toShortText(base, 50);
}

export async function generateSignalInteractions(
  signalId: string,
  logger?: EmbeddingLogger,
): Promise<SignalInteractionSummary> {
  const signal = await findPublishedSignalById(signalId);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  const resonancePersonas = pickPersonas(
    randomInt(aiInteractionMinResonances, aiInteractionMaxResonances),
    signal.id.charCodeAt(0),
  );
  const echoPersonas = resonancePersonas.slice(
    0,
    randomInt(aiInteractionMinEchoes, aiInteractionMaxEchoes),
  );
  let resonanceCount = 0;
  let echoCount = 0;

  for (const persona of resonancePersonas) {
    await createSignalResonanceForPersona({
      actorKey: toPersonaGuestKey(persona),
      guestKey: toPersonaGuestKey(persona),
      signalId,
    });
    resonanceCount += 1;
  }

  for (const persona of echoPersonas) {
    await createSignalEchoForPersona({
      content: buildPersonaEcho({ persona, signal }),
      guestKey: toPersonaGuestKey(persona),
      signalId,
    });
    echoCount += 1;
  }

  logger?.info(
    {
      action: "signal.ai_interactions.generate",
      echoCount,
      resonanceCount,
      targetId: signalId,
      targetType: "SIGNAL",
    },
    "ai signal interactions generated",
  );

  return {
    echoCount,
    resonanceCount,
    signalId,
  };
}

async function generateSignalInteractionEvent(params: {
  logger?: EmbeddingLogger;
  persona: SignalPersona;
  shouldEcho: boolean;
  signalId: string;
}): Promise<SignalInteractionSummary> {
  const signal = await findPublishedSignalById(params.signalId);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  await createSignalResonanceForPersona({
    actorKey: toPersonaGuestKey(params.persona),
    guestKey: toPersonaGuestKey(params.persona),
    signalId: params.signalId,
  });

  if (params.shouldEcho) {
    await createSignalEchoForPersona({
      content: buildPersonaEcho({ persona: params.persona, signal }),
      guestKey: toPersonaGuestKey(params.persona),
      signalId: params.signalId,
    });
  }

  params.logger?.info(
    {
      action: "signal.ai_interaction.generate_event",
      echoCount: params.shouldEcho ? 1 : 0,
      personaId: params.persona.id,
      resonanceCount: 1,
      targetId: params.signalId,
      targetType: "SIGNAL",
    },
    "ai signal interaction event generated",
  );

  return {
    echoCount: params.shouldEcho ? 1 : 0,
    resonanceCount: 1,
    signalId: params.signalId,
  };
}

export function scheduleSignalInteractions(signal: SignalDetail, logger?: EmbeddingLogger) {
  if (
    env.isTest ||
    signal.status !== "PUBLISHED" ||
    scheduledInteractionSignalIds.has(signal.id)
  ) {
    return;
  }

  const events = buildScheduledSignalInteractions(signal.id);

  if (events.length === 0) {
    return;
  }

  scheduledInteractionSignalIds.add(signal.id);

  let pendingEvents = events.length;

  for (const event of events) {
    const timeout = setTimeout(() => {
      void generateSignalInteractionEvent({
        logger,
        persona: event.persona,
        shouldEcho: event.shouldEcho,
        signalId: signal.id,
      })
        .catch((error) => {
          logger?.warn(
            {
              action: "signal.ai_interaction.event_failed",
              reason: toSafeErrorReason(error),
              targetId: signal.id,
              targetType: "SIGNAL",
            },
            "ai signal interaction event failed",
          );
        })
        .finally(() => {
          pendingEvents -= 1;

          if (pendingEvents === 0) {
            scheduledInteractionSignalIds.delete(signal.id);
          }
        });
    }, event.delayMs);

    timeout.unref();
  }
}
