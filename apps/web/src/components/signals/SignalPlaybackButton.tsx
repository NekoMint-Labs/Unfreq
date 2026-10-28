"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSignalAudio, requestSignalAudio } from "@/lib/signal-data";
import type { SignalAudioDetail } from "@unfreq/contracts";
import { SignalActionFeedback } from "./SignalActionFeedback";
import {
  getSignalActionFeedbackState,
  getSignalPlaybackFallbackMessage,
} from "./signal-action-state";

type SignalPlaybackButtonProps = {
  buttonClassName?: string;
  initialAudio?: SignalAudioDetail;
  idleLabel?: string;
  labelPrefix?: string;
  signalId?: string;
  text: string;
};

const pollIntervalMs = 1_500;
const maxPollCount = 12;
const playbackStopEventName = "unfreq:signal-playback-stop";

function toAbsoluteAudioUrl(value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return value;
}

function getReadyAudioUrl(audio: SignalAudioDetail | undefined): string | undefined {
  if (audio?.audioStatus !== "READY") {
    return undefined;
  }

  return audio.audioUrl ?? audio.audioUrlLeft ?? audio.audioUrlRight;
}

export function SignalPlaybackButton({
  buttonClassName,
  idleLabel = "播放",
  initialAudio,
  labelPrefix = "",
  signalId,
  text,
}: SignalPlaybackButtonProps) {
  const speechFallbackSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);
  const [audio, setAudio] = useState<SignalAudioDetail | undefined>(initialAudio);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const instanceKey = useMemo(() => signalId ?? text, [signalId, text]);
  const readyAudioUrl = getReadyAudioUrl(audio);
  const fallbackMessage = getSignalPlaybackFallbackMessage(audio?.audioStatus);
  const errorFeedback = getSignalActionFeedbackState({
    error,
    isPending: false,
  });

  const stopPlayback = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const announcePlaybackStart = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(playbackStopEventName, {
        detail: instanceKey,
      }),
    );
  }, [instanceKey]);

  useEffect(() => {
    const handleStop = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;

      if (detail !== instanceKey) {
        stopPlayback();
      }
    };

    window.addEventListener(playbackStopEventName, handleStop);

    return () => {
      window.removeEventListener(playbackStopEventName, handleStop);
      stopPlayback();
    };
  }, [instanceKey, stopPlayback]);

  const fallbackToBrowserSpeech = useCallback((): boolean => {
    if (!speechFallbackSupported) {
      return false;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.92;
    utterance.pitch = 0.9;
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    announcePlaybackStart();
    audioRef.current?.pause();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsPlaying(true);
    return true;
  }, [announcePlaybackStart, speechFallbackSupported, text]);

  const playServerAudio = useCallback(async (audioDetail = audio) => {
    const url = getReadyAudioUrl(audioDetail);

    if (url === undefined) {
      return;
    }

    audioRef.current?.pause();

    const nextAudio = new Audio(toAbsoluteAudioUrl(url));
    audioRef.current = nextAudio;

    const stop = () => {
      setIsPlaying(false);
      nextAudio.pause();
    };

    nextAudio.addEventListener("ended", stop, { once: true });
    nextAudio.addEventListener("error", stop, { once: true });

    announcePlaybackStart();
    window.speechSynthesis.cancel();
    await nextAudio.play();
    setIsPlaying(true);
  }, [announcePlaybackStart, audio]);

  const pollAudioUntilReady = useCallback(async () => {
    if (signalId === undefined) {
      return undefined;
    }

    for (let count = 0; count < maxPollCount; count += 1) {
      const nextAudio = await getSignalAudio(signalId);
      setAudio(nextAudio);

      if (nextAudio.audioStatus === "READY" || nextAudio.audioStatus === "FAILED") {
        return nextAudio;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, pollIntervalMs);
      });
    }

    return undefined;
  }, [signalId]);

  const toggle = async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    setError(undefined);

    if (readyAudioUrl !== undefined) {
      try {
        await playServerAudio();
      } catch {
        if (!fallbackToBrowserSpeech()) {
          setError("音频暂时无法播放。");
        }
      }
      return;
    }

    if (signalId === undefined) {
      if (!fallbackToBrowserSpeech()) {
        setError("这条信号暂时没有可播放音频。");
      }
      return;
    }

    setIsBusy(true);
    try {
      const requestedAudio = await requestSignalAudio(signalId);
      setAudio(requestedAudio);
      const nextAudio =
        requestedAudio.audioStatus === "PENDING"
          ? await pollAudioUntilReady()
          : requestedAudio;

      if (getReadyAudioUrl(nextAudio) !== undefined) {
        await playServerAudio(nextAudio);
        return;
      }

      if (nextAudio?.audioStatus === "FAILED") {
        setError("服务端音频暂不可用。");
      }

      if (!fallbackToBrowserSpeech()) {
        setError("音频暂时无法播放。");
      }
    } catch {
      if (!fallbackToBrowserSpeech()) {
        setError("音频暂时没有生成。");
      }
    } finally {
      setIsBusy(false);
    }
  };

  const label = (() => {
    if (isPlaying) {
      return "停止播放";
    }

    if (isBusy || audio?.audioStatus === "PENDING") {
      return "生成音频中";
    }

    if (readyAudioUrl !== undefined) {
      return idleLabel;
    }

    if (audio?.audioStatus === "FAILED" && speechFallbackSupported) {
      return "浏览器朗读";
    }

    return idleLabel;
  })();

  return (
    <div className="grid gap-2">
      <button
        className={buttonClassName ?? "radio-button-primary"}
        disabled={
          isBusy ||
          (signalId === undefined && !speechFallbackSupported && readyAudioUrl === undefined)
        }
        onClick={() => {
          void toggle();
        }}
        type="button"
      >
        {`${labelPrefix}${label}`}
      </button>
      <SignalActionFeedback
        className="text-xs text-[color:var(--radio-dim)]"
        message={fallbackMessage}
      />
      <SignalActionFeedback
        className="text-xs text-[color:var(--radio-dim)]"
        kind={errorFeedback?.kind}
        message={errorFeedback?.message}
      />
    </div>
  );
}
