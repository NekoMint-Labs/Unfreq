import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SignalPublishButton } from "@/components/signals/SignalPublishButton";
import { SignalWithdrawButton } from "@/components/signals/SignalWithdrawButton";
import { SignalFingerprintPanel } from "@/components/signals/SignalFingerprintPanel";
import { SignalPlaybackButton } from "@/components/signals/SignalPlaybackButton";
import { SignalResonanceButton } from "@/components/signals/SignalResonanceButton";
import { SignalSaveButton } from "@/components/signals/SignalSaveButton";
import { SignalReportButton } from "@/components/signals/SignalReportButton";
import { MatchedSignalPanel } from "@/components/signals/MatchedSignalPanel";
import { ShareSignalCardPreview } from "@/components/signals/ShareSignalCardPreview";
import { getPublicSignal, getSignal, isSignalGenerationDetail } from "@/lib/signal-data";
import { galaxyHref } from "@/lib/galaxy-navigation";
import type { OwnerSignalDetail, SignalPublicContent } from "@unfreq/contracts";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ onboarding?: string }> };

// Metadata is a public surface. Never forward the page viewer's cookie here.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const signal = await getPublicSignal((await params).id);
  if (signal === undefined) return { title: "私密或未公开信号 | Unfreq", description: "这条信号暂未公开。", robots: { index: false, follow: false } };
  const title = `${signal.authorFreqCode ?? "Unfreq"} 的信号 | Unfreq`;
  const description = signal.expandedText.replace(/\s+/g, " ").slice(0, 86);
  const headerList = await headers();
  const origin = `${headerList.get("x-forwarded-proto") ?? "http"}://${headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000"}`;
  return { title, description, robots: { index: false, follow: false },
    openGraph: { title, description, images: [{ url: `${origin}/api/og/${signal.id}?v=${signal.publicationVersion}`, width: 1200, height: 630 }] } };
}

function PublicContent({ content }: { content: SignalPublicContent }) {
  return <div className="signal-expanded-reading">
    <p className="radio-kicker">EXPANDED SIGNAL</p>
    <p className="signal-archive-confirmed">{content.authorFreqCode ?? "Unfreq"}</p>
    <p className="signal-expanded-text whitespace-pre-wrap my-6">{content.expandedText}</p>
    <div className="flex flex-wrap gap-2">{content.tags.map((tag) => <span className="radio-tag" key={tag}>{tag}</span>)}</div>
  </div>;
}

function OwnerContent({ signal, onboarding, origin }: { signal: OwnerSignalDetail; onboarding: boolean; origin: string }) {
  const publication = signal.publication;
  const labels = { DRAFT: "私密草稿", PUBLIC: "已公开", WITHDRAWN: "已撤回公开", REVIEWING: "审核中", HIDDEN: "审核隐藏", DELETED: "已删除", GENERATING: "生成中", FAILED: "生成未完成", UNCONFIRMED: "等待重新确认" };
  return <>
    <section className="signal-archive-section">
      <p className="text-sm">仅你可见</p>
      <h1 className="my-4 text-2xl">{labels[publication.state]}</h1>
      <p className="signal-seed-whisper whitespace-pre-wrap">{signal.seedText}</p>
      <div className="signal-expanded-reading my-6"><p className="radio-kicker">PRIVATE PREVIEW</p><p className="whitespace-pre-wrap">{signal.expandedText}</p></div>
      <p>原句、生成正文和完整分析在这里供你私密查看。</p>
      <SignalWithdrawButton signalId={signal.id} publicationVersion={publication.version} canWithdraw={publication.canWithdraw && (signal.status === "PUBLISHED" || publication.publishedContent !== undefined)} />
    </section>
    {publication.canPublish && publication.preview ? <section className="signal-archive-section" aria-label="发布预览">
      <h2 className="text-xl mb-5">{publication.state === "WITHDRAWN" ? "重新发布预览" : "发布预览"}</h2>
      <SignalPublishButton key={`${signal.id}:${publication.preview.version}:${publication.preview.digest}`} signalId={signal.id} preview={publication.preview} republish={publication.state === "WITHDRAWN"} />
    </section> : null}
    {publication.state === "REVIEWING" || publication.state === "HIDDEN" ? <p className="signal-archive-section">需等待审核结果，当前不能公开或重新发布。</p> : null}
    {publication.state === "PUBLIC" && publication.publishedContent ? <section className="signal-archive-section">
      <h2 className="mb-4">当前公开内容</h2><PublicContent content={publication.publishedContent} />
      <div className="mt-5"><SignalPlaybackButton signalId={signal.id} text={publication.publishedContent.expandedText} /><SignalResonanceButton signalId={signal.id} initialCount={signal.resonanceCount} /><SignalSaveButton signalId={signal.id} initialSaved={signal.hasSaved} /></div>
    </section> : null}
    {publication.state === "PUBLIC" ? <>
      {onboarding ? <section className="tour-panel-result" role="status"><h2>读回声里的自己</h2><Link href={galaxyHref({ focus: signal.id, onboarding: "galaxy" })}>进入星图</Link></section> : null}
      <MatchedSignalPanel matches={signal.matches} />
      <section className="signal-archive-section signal-action-section"><Link className="signal-next-primary" href={galaxyHref({ focus: signal.id, onboarding: onboarding ? "galaxy" : undefined })}>进入星图</Link></section>
      <ShareSignalCardPreview card={{ signalId: signal.id, frequencyCode: publication.publishedContent?.authorFreqCode ?? "Unfreq", expandedText: publication.publishedContent?.expandedText ?? "", imageUrl: `${origin}/api/og/${signal.id}?v=${publication.version}` }} shareUrl={`${origin}/result/${signal.id}`} />
    </> : null}
    <details className="signal-archive-section"><summary>查看完整分析（私密）</summary><SignalFingerprintPanel fingerprint={signal.fingerprint} /></details>
    {signal.followUpQuestion ? <section className="signal-archive-section"><p className="radio-kicker">NEXT SIGNAL</p><p>{signal.followUpQuestion}</p></section> : null}
    <section className="signal-archive-section flex flex-wrap gap-4">
      <Link className="signal-next-secondary" href={`/?parentSignalId=${signal.id}${signal.followUpQuestion ? `&seed=${encodeURIComponent(signal.followUpQuestion)}` : ""}`}>继续写 seed</Link>
      <Link className="signal-next-secondary" href="/me">我的频率</Link>
    </section>
  </>;
}

export default async function SignalResultPage({ params, searchParams }: Props) {
  const { id } = await params;
  const onboarding = (await searchParams).onboarding === "result";
  const headerList = await headers();
  const signal = await getSignal(id, headerList.get("cookie") ?? undefined);
  if (signal === undefined) notFound();
  if (isSignalGenerationDetail(signal)) redirect(`/signal/${signal.id}/transmitting${onboarding ? "?onboarding=result" : ""}`);
  if (signal.visibility === "REVIEW_RESTRICTED") return <section className="signal-archive-section"><h1>信号审核中</h1><p>这条信号暂未公开。</p></section>;
  const origin = `${headerList.get("x-forwarded-proto") ?? "http"}://${headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000"}`;
  if (signal.visibility === "PRIVATE_OWNER") return <section className="signal-archive-page"><OwnerContent signal={signal} onboarding={onboarding} origin={origin} /></section>;
  return <section className="signal-archive-page">
    <section className="signal-archive-section"><p className="radio-kicker">PUBLIC SIGNAL</p><PublicContent content={signal} /></section>
    <section className="signal-archive-section"><div className="signal-archive-actions">
      <SignalPlaybackButton signalId={signal.id} text={signal.expandedText} />
      <SignalResonanceButton signalId={signal.id} initialCount={signal.resonanceCount} />
      <SignalSaveButton signalId={signal.id} initialSaved={signal.hasSaved} />
      <SignalReportButton signalId={signal.id} />
    </div></section>
    <MatchedSignalPanel matches={signal.matches} />
    <ShareSignalCardPreview card={{ signalId: signal.id, frequencyCode: signal.authorFreqCode ?? "Unfreq", expandedText: signal.expandedText, imageUrl: `${origin}/api/og/${signal.id}?v=${signal.publicationVersion}` }} shareUrl={`${origin}/result/${signal.id}`} />
    <section className="signal-archive-section"><Link className="signal-next-primary" href={galaxyHref({ focus: signal.id })}>进入星图</Link></section>
  </section>;
}
