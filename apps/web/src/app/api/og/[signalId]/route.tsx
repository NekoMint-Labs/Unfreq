import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getPublicSignal } from "@/lib/signal-data";

export const runtime = "edge";

type SignalOgRouteContext = {
  params: Promise<{
    signalId: string;
  }>;
};

const imageSize = {
  height: 630,
  width: 1200,
} as const;

const maxCardTextLength = 126;

function truncateCardText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxCardTextLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxCardTextLength - 1)}…`;
}

export async function GET(request: Request, context: SignalOgRouteContext) {
  const { signalId } = await context.params;
  const signal = await getPublicSignal(signalId);

  if (signal === undefined) {
    notFound();
  }

  const version = new URL(request.url).searchParams.get("v");
  if (version !== null && (!/^[1-9]\d{0,9}$/u.test(version) || Number(version) !== signal.publicationVersion)) notFound();
  const frequencyCode = signal.authorFreqCode ?? "Unfreq";
  const cardText = truncateCardText(signal.expandedText);

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
          fontFamily:
            'Noto Sans SC, PingFang SC, Microsoft YaHei, SimSun, serif',
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
              fontFamily:
                'Geist Mono, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 30,
              letterSpacing: "0.08em",
            }}
          >
            {frequencyCode}
          </div>
          <div
            style={{
              border: "1px solid rgba(232, 232, 240, 0.16)",
              borderRadius: 8,
              color: "#8B8B9C",
              display: "flex",
              fontFamily:
                'Geist Mono, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 20,
              letterSpacing: "0.18em",
              padding: "12px 16px",
            }}
          >
            UNFREQ
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
              fontFamily:
                'Geist Mono, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 18,
              letterSpacing: "0.22em",
            }}
          >
            EXPANDED SIGNAL
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
          <div style={{ display: "flex" }}>每个想法都不再孤独</div>
          <div
            style={{
              color: "#4A4A5C",
              display: "flex",
              fontFamily:
                'Geist Mono, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 18,
              letterSpacing: "0.14em",
            }}
          >
            unfreq.space
          </div>
        </div>
      </div>
    ),
    {
      ...imageSize,
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
