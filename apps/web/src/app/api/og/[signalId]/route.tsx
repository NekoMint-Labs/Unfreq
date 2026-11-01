import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getPublicSignal } from "@/lib/signal-data";
import { getLocalOgTypography } from "@/lib/og-local-fonts";

export const runtime = "nodejs";

type SignalOgRouteContext = {
  params: Promise<{
    signalId: string;
  }>;
};

const imageSize = {
  height: 630,
  width: 1200,
} as const;

export async function GET(request: Request, context: SignalOgRouteContext) {
  const { signalId } = await context.params;
  const signal = await getPublicSignal(signalId);

  if (signal === undefined) {
    notFound();
  }

  const version = new URL(request.url).searchParams.get("v");
  if (version !== null && (!/^[1-9]\d{0,9}$/u.test(version) || Number(version) !== signal.publicationVersion)) notFound();
  const typography = await getLocalOgTypography();
  const frequency = typography.formatText(signal.authorFreqCode ?? "Unfreq");
  const card = typography.formatCardText(signal.expandedText);
  const cardText = card.text;
  const label = (value: string) => typography.formatText(value).text;
  const glyphNotice = card.substituted || frequency.substituted;

  const rendered = new ImageResponse(
    (
      <div
        lang="zh-CN"
        style={{
          alignItems: "stretch",
          backgroundColor: "#0A0A12",
          color: "#E8E8F0",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Unfreq Sans, Unfreq Mono",
          height: "100%",
          justifyContent: "space-between",
          padding: "68px 76px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background:
              "radial-gradient(circle, rgba(232, 232, 240, 0.13) 0%, rgba(232, 232, 240, 0.05) 30%, rgba(232, 232, 240, 0) 70%)",
            borderRadius: 999,
            display: "flex",
            height: 430,
            position: "absolute",
            right: -92,
            top: -132,
            width: 430,
          }}
        />
        <div
          style={{
            background:
              "radial-gradient(circle, rgba(232, 232, 240, 0.09) 0%, rgba(232, 232, 240, 0.04) 32%, rgba(232, 232, 240, 0) 72%)",
            borderRadius: 999,
            bottom: -150,
            display: "flex",
            height: 360,
            left: -80,
            position: "absolute",
            width: 360,
          }}
        />
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
            position: "relative",
            width: "100%",
          }}
        >
          <div
            style={{
              color: "#E8E8F0",
              fontFamily: "Unfreq Mono, Unfreq Sans",
              fontSize: 30,
              letterSpacing: "0.08em",
            }}
          >
            {frequency.text}
          </div>
          <div
            style={{
              border: "1px solid rgba(232, 232, 240, 0.16)",
              borderRadius: 8,
              color: "#8B8B9C",
              display: "flex",
              fontFamily: "Unfreq Mono, Unfreq Sans",
              fontSize: 20,
              letterSpacing: "0.18em",
              padding: "12px 16px",
            }}
          >
            {label("UNFREQ")}
          </div>
        </div>
        <div
          style={{
            borderLeft: "2px solid rgba(232, 232, 240, 0.58)",
            display: "flex",
            flexDirection: "column",
            gap: 22,
            maxWidth: 880,
            paddingLeft: 30,
            position: "relative",
          }}
        >
          <div
            style={{
              color: "#4A4A5C",
              fontFamily: "Unfreq Mono, Unfreq Sans",
              fontSize: 18,
              letterSpacing: "0.22em",
            }}
          >
            {label("EXPANDED SIGNAL")}
          </div>
          <div
            style={{
              color: "#E8E8F0",
              fontSize: cardText.length > 96 ? 40 : 46,
              letterSpacing: 0,
              lineHeight: 1.54,
              whiteSpace: "pre-wrap",
            }}
          >
            {cardText}
          </div>
        </div>
        <div
          style={{
            alignItems: "flex-end",
            color: "#8B8B9C",
            display: "flex",
            fontSize: 24,
            justifyContent: "space-between",
            position: "relative",
            width: "100%",
          }}
        >
          <div style={{ display: "flex" }}>{label(glyphNotice ? "部分字形/表情以 [?] 显示" : "每个想法都不再孤独")}</div>
          <div
            style={{
              color: "#4A4A5C",
              display: "flex",
              fontFamily: "Unfreq Mono, Unfreq Sans",
              fontSize: 18,
              letterSpacing: "0.14em",
            }}
          >
            {label("unfreq.space")}
          </div>
        </div>
      </div>
    ),
    {
      ...imageSize,
      fonts: typography.fonts,
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    },
  );
  const bytes = await rendered.arrayBuffer();
  // PNG rendering is asynchronous: recheck before releasing the rendered copy.
  const current = await getPublicSignal(signalId);
  if (current === undefined || current.publicationVersion !== signal.publicationVersion) notFound();
  return new Response(bytes, { headers: rendered.headers });

}
