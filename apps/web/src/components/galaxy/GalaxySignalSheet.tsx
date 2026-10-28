"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { SignalPlaybackButton } from "@/components/signals/SignalPlaybackButton";
import { SignalResonanceButton } from "@/components/signals/SignalResonanceButton";
import { SignalSaveButton } from "@/components/signals/SignalSaveButton";
import type { GalaxySignalPoint } from "@unfreq/contracts";
import { detailFadeDurationSeconds } from "./galaxy-scene-constants";

function GalaxySignalDetailContent({
  point,
  onClose,
}: {
  onClose: () => void;
  point: GalaxySignalPoint;
}) {
  return (
    <div
      className="galaxy-detail-content relative z-10"
      onClick={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        aria-label="关闭信号详情"
        className="galaxy-close-button fixed right-5 top-16 z-[1200] inline-flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/20 font-mono text-2xl leading-none text-white/70 transition hover:border-white/30 hover:bg-white/[0.06] md:top-5"
        onClick={onClose}
        type="button"
      >
        ×
      </button>

      <div className="galaxy-detail-heading">
        <p className="radio-kicker">SELECTED SIGNAL</p>
        <p className="mt-3 font-mono text-sm tracking-[0.24em] text-white/70">
          {point.frequencyCode}
        </p>
      </div>

      <div className="galaxy-sheet-tags">
        <span>{point.resonanceCount} RESONANCE</span>
        <span aria-hidden="true">·</span>
        <span>{point.frequencyProfile.displayText}</span>
        {point.isMine ? (
          <>
            <span aria-hidden="true">·</span>
            <span>MY FREQUENCY</span>
          </>
        ) : null}
      </div>

      <div className="galaxy-sheet-body">
        <p className="galaxy-reading-text max-w-[24em] font-serif text-xl leading-[1.86] text-[color:var(--text-primary)] md:text-3xl md:leading-[1.78] xl:text-4xl xl:leading-[1.72]">
          {point.expandedText}
        </p>
      </div>

      <div className="galaxy-sheet-actions">
        <SignalPlaybackButton
          buttonClassName="galaxy-text-action"
          idleLabel="播放"
          signalId={point.id}
          text={point.expandedText}
        />
        <SignalResonanceButton
          activeButtonClassName="galaxy-text-action galaxy-text-action-active"
          buttonClassName="galaxy-text-action"
          initialCount={point.resonanceCount}
          signalId={point.id}
        />
        <SignalSaveButton
          activeButtonClassName="galaxy-text-action galaxy-text-action-active"
          buttonClassName="galaxy-text-action"
          signalId={point.id}
        />
        <Link className="radio-button-text galaxy-open-link" href={`/result/${point.id}`}>
          打开结果
        </Link>
      </div>

      <button className="galaxy-return-link" onClick={onClose} type="button">
        [ × 隐 去 ]
      </button>
    </div>
  );
}

export function GalaxySignalSheet({
  isVisible,
  point,
  onClose,
}: {
  isVisible: boolean;
  onClose: () => void;
  point: GalaxySignalPoint;
}) {
  return (
    <motion.aside
      animate={{
        opacity: isVisible ? 1 : 0,
        y: isVisible ? 0 : 28,
      }}
      className="galaxy-sheet"
      exit={{ opacity: 0, y: 28 }}
      initial={{ opacity: 0, y: 28 }}
      onClick={onClose}
      transition={{
        delay: isVisible ? 0.18 : 0,
        duration: detailFadeDurationSeconds,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <GalaxySignalDetailContent onClose={onClose} point={point} />
    </motion.aside>
  );
}
