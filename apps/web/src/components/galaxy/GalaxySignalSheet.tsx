"use client";

import { motion } from "framer-motion";
import { useEffect, useId, useRef, type RefObject } from "react";
import Link from "next/link";
import { SignalPlaybackButton } from "@/components/signals/SignalPlaybackButton";
import { SignalResonanceButton } from "@/components/signals/SignalResonanceButton";
import { SignalSaveButton } from "@/components/signals/SignalSaveButton";
import { SignalReportButton } from "@/components/signals/SignalReportButton";
import type { GalaxySignalPoint } from "@unfreq/contracts";
import { detailFadeDurationSeconds } from "./galaxy-scene-constants";
import { getGalaxyAssociationInfo, galaxyAssociationMethod, galaxyAssociationDistance } from "./galaxy-semantics";

function GalaxySignalDetailContent({
  point,
  onClose,
  sample,
  titleId,
}: {
  onClose: () => void;
  point: GalaxySignalPoint;
  sample: readonly GalaxySignalPoint[];
  titleId: string;
}) {
  const association = getGalaxyAssociationInfo(point, sample);
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
      <div className="galaxy-detail-heading">
        <p className="radio-kicker">SELECTED SIGNAL</p>
        <h2 id={titleId} className="mt-3 font-mono text-sm tracking-[0.24em] text-white/70">
          <span className="sr-only">信号阅读：</span>
          {point.authorFreqCode ?? "Unfreq"}
        </h2>
      </div>

      <div className="galaxy-sheet-tags">
        <span>{point.resonanceCount} RESONANCE</span>
        <span aria-hidden="true">·</span>
        <span>{point.tags.join(" / ")}</span>
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

      <details className="galaxy-association-note">
        <summary>关联说明</summary>
        <p>{association.text}</p>
        <p>{galaxyAssociationMethod}</p>
        <p>{galaxyAssociationDistance}</p>
      </details>

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
        <SignalReportButton buttonClassName="galaxy-text-action" signalId={point.id} />
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
  sample,
  reducedMotion,
  returnFocusRef,
}: {
  isVisible: boolean;
  onClose: () => void;
  point: GalaxySignalPoint;
  sample: readonly GalaxySignalPoint[];
  reducedMotion: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const helpId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isVisible) {
      const returnTarget = returnFocusRef.current ?? document.querySelector<HTMLButtonElement>('[aria-controls="galaxy-sample-list"]');
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLButtonElement>(".galaxy-close-button")?.focus({ preventScroll: true });
      const oldOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        dialog.close();
        document.body.style.overflow = oldOverflow;
        if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      };
    }
  }, [isVisible, returnFocusRef]);

  return (
    <motion.dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || (event.target as Element).closest("dialog") !== event.currentTarget) return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button,a[href],input,select,textarea,summary,[tabindex]"))
          .filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0]; const last = controls[controls.length - 1];
        if (!first || !last) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      animate={{
        opacity: isVisible ? 1 : 0,
        y: isVisible || reducedMotion ? 0 : 28,
      }}
      className="galaxy-sheet"
      exit={{ opacity: 0, y: 28 }}
      initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 28 }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      transition={{
        delay: isVisible && !reducedMotion ? 0.18 : 0,
        duration: reducedMotion ? 0 : detailFadeDurationSeconds,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <button
        aria-label="关闭信号详情"
        className="galaxy-close-button"
        onClick={onClose}
        type="button"
      >×</button>
      <p id={helpId} className="sr-only">当前公开表达。使用 Tab 浏览操作，按 Escape 关闭并返回原来的位置。</p>
      <div className="galaxy-reader-scroll" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <GalaxySignalDetailContent onClose={onClose} point={point} sample={sample} titleId={titleId} />
      </div>
    </motion.dialog>
  );
}
