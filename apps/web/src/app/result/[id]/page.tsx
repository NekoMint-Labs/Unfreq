import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ShareSignalCardPreview } from "@/components/signals/ShareSignalCardPreview";
import { SignalPlaybackButton } from "@/components/signals/SignalPlaybackButton";
import { SignalPublishButton } from "@/components/signals/SignalPublishButton";
import { SignalResonanceButton } from "@/components/signals/SignalResonanceButton";
import { SignalSaveButton } from "@/components/signals/SignalSaveButton";
import { getSignal, isSignalGenerationDetail, isSignalPreviewDetail } from "@/lib/signal-data";
import type {
  ReviewingSignalRestrictedDetail,
  SignalDetail,
  SignalPreviewDetail,
} from "@unfreq/contracts";

export const dynamic = "force-dynamic";

type SignalResultPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    onboarding?: string;
  }>;
};

function parseResultOnboardingStep(value?: string): "result" | undefined {
  return value === "result" ? value : undefined;
}

function isReviewingRestrictedSignal(
  signal: NonNullable<Awaited<ReturnType<typeof getSignal>>>,
): signal is ReviewingSignalRestrictedDetail {
  return "visibility" in signal && signal.visibility === "REVIEW_RESTRICTED";
}

function getSignalFrequencyCode(signal: SignalDetail) {
  return signal.authorFreqCode ?? signal.fingerprint.frequency ?? "Unfreq";
}

function getOriginFromHeaders(headersList: Awaited<ReturnType<typeof headers>>): string {
  const forwardedProto = headersList.get("x-forwarded-proto") ?? "http";
  const forwardedHost = headersList.get("x-forwarded-host");
  const host = forwardedHost ?? headersList.get("host") ?? "localhost:3000";

  return `${forwardedProto}://${host}`;
}

function getShareImageUrl(signalId: string, origin: string): string {
  return `${origin}/api/og/${signalId}`;
}

function getShareUrl(signalId: string, origin: string): string {
  return `${origin}/result/${signalId}`;
}

function getTransmittingUrl(signalId: string, onboardingStep?: "result"): string {
  const transmittingPath = `/signal/${signalId}/transmitting`;

  return onboardingStep === "result"
    ? `${transmittingPath}?onboarding=result`
    : transmittingPath;
}

function truncateDescription(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 86) {
    return normalized;
  }

  return `${normalized.slice(0, 85)}…`;
}

export async function generateMetadata({ params }: SignalResultPageProps): Promise<Metadata> {
  const { id } = await params;
  const headersList = await headers();
  const signal = await getSignal(id, headersList.get("cookie") ?? undefined);

  if (signal === undefined) {
    return {
      title: "信号不存在 | Unfreq",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  if (isSignalGenerationDetail(signal)) {
    return {
      title: "信号生成中 | Unfreq",
      description: "这条信号正在生成。",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  if (isSignalPreviewDetail(signal)) {
    return {
      title: "信号待发布 | Unfreq",
      description: "这条信号已生成，等待作者确认发布。",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  if (isReviewingRestrictedSignal(signal) || signal.status === "REVIEWING") {
    return {
      title: "信号审核中 | Unfreq",
      description: "这条信号暂未公开。",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const origin = getOriginFromHeaders(headersList);
  const frequencyCode = getSignalFrequencyCode(signal);
  const title = `${frequencyCode} 的信号 | Unfreq`;
  const description = truncateDescription(signal.expandedText);
  const imageUrl = getShareImageUrl(signal.id, origin);

  return {
    title,
    description,
    openGraph: {
      type: "website",
      title,
      description,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${frequencyCode} 的 Unfreq 信号卡片`,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [
        {
          url: imageUrl,
          alt: `${frequencyCode} 的 Unfreq 信号卡片`,
        },
      ],
    },
  };
}

function ReviewingRestrictedResult({ signal }: { signal: ReviewingSignalRestrictedDetail }) {
  return (
    <section className="signal-archive-page">
      <div className="signal-archive-toolbar">
        <p className="signal-archive-confirmed">UNFREQ</p>
        <Link className="signal-archive-text-link" href="/">
          返回首页
        </Link>
      </div>

      <section className="signal-archive-section signal-empty-section" role="status">
        <p className="radio-kicker">REVIEWING</p>
        <h1>这条信号暂未公开</h1>
        <p>
          它还在审核中。公开前，seed、扩写内容和互动能力都不会对其他频率展示。
        </p>
        <div className="signal-next-step-row">
          <Link className="signal-next-secondary" href="/">
            发射新 seed
          </Link>
          <Link className="signal-next-secondary" href="/galaxy">
            进入星图
          </Link>
        </div>
      </section>

      <section className="signal-archive-section signal-metadata-section">
        <div className="signal-archive-meta">
          <span className="home-micro-text">REVIEWING</span>
          <time className="home-micro-text" dateTime={signal.updatedAt}>
            {new Date(signal.updatedAt).toLocaleString("zh-CN")}
          </time>
        </div>
        <p>信号公开后才会进入同频匹配和星图展示。</p>
      </section>
    </section>
  );
}

function PreviewOwnerResult({ signal }: { signal: SignalPreviewDetail }) {
  return (
    <section className="signal-archive-page">
      <div className="signal-archive-toolbar">
        <p className="signal-archive-confirmed">{getSignalFrequencyCode(signal)}</p>
        <Link className="signal-archive-text-link" href="/">
          发射新 seed
        </Link>
      </div>

      <article className="signal-archive-hero">
        <div className="signal-seed-whisper">
          <p className="radio-kicker">ORIGINAL SEED</p>
          <p>{signal.seedText}</p>
        </div>
        <div className="signal-expanded-reading" role="status">
          <p className="radio-kicker">PRIVATE PREVIEW</p>
          <p>{signal.expandedText}</p>
        </div>
      </article>

      <section className="signal-archive-section signal-action-section">
        <div className="signal-action-heading">
          <div>
            <p className="radio-kicker">PUBLISH</p>
            <p>确认后，这条信号会进入结果页、星图和同频匹配。</p>
          </div>
          <SignalPublishButton signalId={signal.id} />
        </div>
        <div className="signal-next-step-row">
          <Link className="signal-next-secondary" href="/">
            暂不发布
          </Link>
          <Link className="signal-next-secondary" href="/me">
            我的频率
          </Link>
        </div>
      </section>

      <section className="signal-archive-section signal-metadata-section">
        <div className="signal-archive-meta">
          <span className="home-micro-text">PRIVATE PREVIEW</span>
          <time className="home-micro-text" dateTime={signal.updatedAt}>
            {new Date(signal.updatedAt).toLocaleString("zh-CN")}
          </time>
        </div>
        <p>发布前，其他频率无法读取这条信号。</p>
      </section>
    </section>
  );
}

function ReviewingOwnerResult({ signal }: { signal: SignalDetail }) {
  return (
    <section className="signal-archive-page">
      <div className="signal-archive-toolbar">
        <p className="signal-archive-confirmed">{getSignalFrequencyCode(signal)}</p>
        <Link className="signal-archive-text-link" href="/">
          发射新 seed
        </Link>
      </div>

      <article className="signal-archive-hero">
        <div className="signal-seed-whisper">
          <p className="radio-kicker">ORIGINAL SEED</p>
          <p>{signal.seedText}</p>
        </div>
        <div className="signal-expanded-reading" role="status">
          <p className="radio-kicker">REVIEWING</p>
          <p>
            这句 seed 已保存，正在审核中。公开前不会展示扩写、同频、共鸣、收藏、分享或播放。
          </p>
        </div>
      </article>

      <section className="signal-archive-section signal-action-section">
        <div className="signal-action-heading">
          <div>
            <p className="radio-kicker">ACTIONS</p>
            <p>审核完成后，这条信号才会进入公开结果页。</p>
          </div>
          <Link className="signal-next-primary" href="/">
            返回首页
          </Link>
        </div>
        <div className="signal-next-step-row">
          <Link className="signal-next-secondary" href="/me">
            我的频率
          </Link>
        </div>
      </section>

      <section className="signal-archive-section signal-metadata-section">
        <div className="signal-archive-meta">
          <span className="home-micro-text">REVIEWING</span>
          <time className="home-micro-text" dateTime={signal.updatedAt}>
            {new Date(signal.updatedAt).toLocaleString("zh-CN")}
          </time>
        </div>
        <p>当前仅作者可确认 seed 已保存。</p>
      </section>
    </section>
  );
}

export default async function SignalResultPage({ params, searchParams }: SignalResultPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const onboardingStep = parseResultOnboardingStep(query.onboarding);
  const headersList = await headers();
  const signal = await getSignal(id, headersList.get("cookie") ?? undefined);

  if (signal === undefined) {
    notFound();
  }

  if (isReviewingRestrictedSignal(signal)) {
    return <ReviewingRestrictedResult signal={signal} />;
  }

  if (isSignalGenerationDetail(signal)) {
    redirect(getTransmittingUrl(signal.id, onboardingStep));
  }

  if (isSignalPreviewDetail(signal)) {
    return <PreviewOwnerResult signal={signal} />;
  }

  if (signal.status === "REVIEWING") {
    return <ReviewingOwnerResult signal={signal} />;
  }

  const followUpHref = signal.followUpQuestion
    ? `/?seed=${encodeURIComponent(signal.followUpQuestion)}&parentSignalId=${encodeURIComponent(signal.id)}`
    : "/";
  const origin = getOriginFromHeaders(headersList);
  const frequencyCode = getSignalFrequencyCode(signal);
  const shareCard = {
    expandedText: signal.expandedText,
    frequencyCode,
    imageUrl: getShareImageUrl(signal.id, origin),
    signalId: signal.id,
  };
  const shareUrl = getShareUrl(signal.id, origin);
  const galaxyHref = onboardingStep === "result" ? "/galaxy?onboarding=galaxy" : "/galaxy";
  const primaryNextStep = signal.followUpQuestion
    ? {
        href: followUpHref,
        label: "继续写 seed",
        note: "继续这条问题",
      }
    : {
        href: galaxyHref,
        label: "进入星图",
        note: "进入共振星图",
      };
  const resonanceKeywords = signal.frequencyProfile.resonanceKeywords.slice(0, 3);
  const sameFrequencyMatches = signal.matches.slice(0, 3);

  return (
    <section className="signal-archive-page">
      <div className="signal-archive-toolbar">
        <p className="signal-archive-confirmed">{frequencyCode}</p>
        <Link className="signal-archive-text-link" href="/">
          发射新 seed
        </Link>
      </div>

      {onboardingStep === "result" ? (
        <section className="tour-panel tour-panel-result" role="status">
          <p className="radio-kicker">FIRST TUNE · 02</p>
          <h1>读回声里的自己</h1>
          <p>
            先读中间那段被扩写后的信号，再向下看同频信号。若某个陌生 FM 让你停住，点「我也想过」留下共鸣。读完后进入星图。
          </p>
          <Link className="radio-button-primary" href={galaxyHref}>
            进入星图
          </Link>
        </section>
      ) : null}

      <article className="signal-archive-hero">
        <div className="signal-seed-whisper">
          <p className="radio-kicker">ORIGINAL SEED</p>
          <p>
            {signal.seedText}
          </p>
        </div>
        <div className="signal-expanded-reading">
          <p className="radio-kicker">EXPANDED SIGNAL</p>
          <p>
            {signal.expandedText}
          </p>
        </div>
      </article>

      {sameFrequencyMatches.length > 0 ? (
        <section className="signal-archive-section signal-matches-section">
          <div className="signal-section-heading">
            <p className="radio-kicker">SAME FREQUENCY</p>
            <Link className="signal-archive-text-link" href={galaxyHref}>
              进入星图
            </Link>
          </div>
          <div className="signal-match-grid">
            {sameFrequencyMatches.map((match) => (
              <div
                className="signal-archive-match"
                key={match.id}
              >
                <span aria-hidden="true" className="signal-match-rule" />
                <p className="signal-match-frequency">
                  {match.frequencyCode}
                </p>
                <h2>也在思考：</h2>
                <p className="signal-match-seed">
                  {match.frequencyProfile.innerConflict}
                </p>
                {match.seedText ? (
                  <p className="signal-match-seed">
                    {match.seedText}
                  </p>
                ) : null}
                <p>
                  {match.expandedText}
                </p>
                <div className="signal-match-actions">
                  {match.source === "PUBLISHED" ? (
                    <Link className="signal-match-play" href={`/result/${match.id}`}>
                      打开信号
                    </Link>
                  ) : null}
                  <SignalPlaybackButton
                    buttonClassName="signal-match-play"
                    idleLabel="播放"
                    labelPrefix="▷ "
                    signalId={match.source === "PUBLISHED" ? match.id : undefined}
                    text={match.expandedText}
                  />
                  {match.source === "PUBLISHED" ? (
                    <SignalResonanceButton
                      buttonClassName="signal-match-play"
                      initialCount={match.resonanceCount}
                      signalId={match.id}
                    />
                  ) : null}
                  {match.source === "PUBLISHED" ? (
                    <SignalSaveButton buttonClassName="signal-match-play" signalId={match.id} />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="signal-archive-section signal-empty-section">
          <p className="radio-kicker">SAME FREQUENCY</p>
          <p>
            暂时没有足够接近的公开信号。可以先调频接收陌生信号。
          </p>
          <Link className="signal-archive-text-link" href={galaxyHref}>
            进入星图
          </Link>
        </section>
      )}

      <section className="signal-archive-section signal-action-section">
        <div className="signal-action-heading">
          <div>
            <p className="radio-kicker">ACTIONS</p>
            <p>{primaryNextStep.note}</p>
          </div>
          <Link className="signal-next-primary" href={primaryNextStep.href}>
            {primaryNextStep.label}
          </Link>
        </div>
        <div className="signal-next-step-row">
          {signal.followUpQuestion ? (
            <Link className="signal-next-secondary" href={galaxyHref}>
              进入星图
            </Link>
          ) : (
            <Link className="signal-next-secondary" href="/">
              继续发射
            </Link>
          )}
          <Link className="signal-next-secondary" href="/me">
            我的频率
          </Link>
        </div>
        <div className="signal-archive-actions">
          <SignalPlaybackButton
            buttonClassName="signal-play-inline"
            initialAudio={{
              audioError: signal.audioError,
              audioStatus: signal.audioStatus,
              audioUrl: signal.audioUrl,
              audioUrlLeft: signal.audioUrlLeft,
              audioUrlRight: signal.audioUrlRight,
              signalId: signal.id,
            }}
            idleLabel="播放"
            labelPrefix="▷ "
            signalId={signal.id}
            text={signal.expandedText}
          />
          <SignalResonanceButton
            activeButtonClassName="signal-play-inline"
            buttonClassName="signal-play-inline"
            initialCount={signal.resonanceCount}
            signalId={signal.id}
          />
          <SignalSaveButton
            activeButtonClassName="signal-play-inline"
            buttonClassName="signal-play-inline"
            initialSaved={signal.hasSaved}
            signalId={signal.id}
          />
        </div>
      </section>

      <section className="signal-archive-section signal-metadata-section">
        <div className="signal-archive-meta">
          <span className="home-micro-text">
            {frequencyCode}
          </span>
          <time
            className="home-micro-text"
            dateTime={signal.updatedAt}
          >
            {new Date(signal.updatedAt).toLocaleString("zh-CN")}
          </time>
        </div>
        <p>
          {resonanceKeywords.length > 0
            ? `相近的信号：${resonanceKeywords.join("、")}`
            : signal.frequencyProfile.displayText}
        </p>
      </section>

      <ShareSignalCardPreview card={shareCard} shareUrl={shareUrl} />

      {signal.followUpQuestion ? (
        <section className="signal-archive-section signal-follow-section">
          <p className="radio-kicker">NEXT SIGNAL</p>
          <p>
            {signal.followUpQuestion}
          </p>
          <div>
            <Link className="signal-archive-text-link" href={followUpHref}>
              继续写 seed
            </Link>
          </div>
        </section>
      ) : null}
    </section>
  );
}
