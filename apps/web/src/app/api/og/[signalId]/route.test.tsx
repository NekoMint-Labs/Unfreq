import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { getLocalOgTypography } from "../../../../lib/og-local-fonts";

const findSignal = vi.hoisted(() => vi.fn());
vi.mock("@/lib/signal-data", () => ({ getPublicSignal: findSignal }));
// The existing Web unit runner has no @ alias; forward to the real helper.
vi.mock("@/lib/og-local-fonts", () => import("../../../../lib/og-local-fonts"));
vi.mock("next/navigation", () => ({ notFound() { throw new Error("SYNTHETIC_OG_NOT_FOUND"); } }));
import { GET, runtime } from "./route";

const syntheticSignal = {
  id: "synthetic-offline-og", publicationVersion: 3, authorFreqCode: "FM 78.23",
  expandedText: "合成公开正文：今天考试通过了，很开心🙂！罕见字𠮷，English 2026。",
};
const request = (version = "3") => new Request(`http://127.0.0.1/api/og/${syntheticSignal.id}?v=${version}`);
const context = () => ({ params: Promise.resolve({ signalId: syntheticSignal.id }) });
const nativeFetch = globalThis.fetch;
const blockedOutbound = vi.fn(async () => { throw new Error("SYNTHETIC_OG_OUTBOUND_BLOCKED"); });

function expectAtomicCardText(text: string) {
  expect(text.length).toBeLessThanOrEqual(126);
  const withoutPlaceholders = text.replaceAll("[?]", "");
  expect(withoutPlaceholders).not.toContain("[");
  expect(withoutPlaceholders).not.toContain("]");
  expect(Array.from(text).some((character) => character.length === 1 &&
    character.charCodeAt(0) >= 0xd800 && character.charCodeAt(0) <= 0xdfff)).toBe(false);
}

async function brightPixels(png: Buffer, region: { left: number; top: number; width: number; height: number }) {
  const { data, info } = await sharp(png).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index]! > 110 && data[index + 1]! > 110 && data[index + 2]! > 110) count += 1;
  }
  return count;
}

beforeEach(() => {
  findSignal.mockReset().mockResolvedValue(syntheticSignal);
  blockedOutbound.mockClear();
  // Real ImageResponse/WOFF/sharp rendering is used. Even a request for a
  // synthetic character must fail instead of reaching a CDN. Next's bundled
  // Yoga may fetch its inlined data: WASM; that local read uses no network.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    return url.protocol === "data:" ? nativeFetch(input, init) : blockedOutbound();
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("offline share-card typography and publication gates", () => {
  it("keeps common Chinese, Latin and FM digits using two cached local fonts", async () => {
    const typography = await getLocalOgTypography();
    const original = "每个想法都不再孤独。今天考试通过了！Hello FM 78.23 2026";
    expect(typography.formatText(original)).toEqual({ text: original, substituted: false });
    expect(typography.fonts.map((font) => font.name)).toEqual(["Unfreq Sans", "Unfreq Mono"]);
    expect(await getLocalOgTypography()).toBe(typography);
    expect(blockedOutbound).not.toHaveBeenCalled();
  });

  it.each(["🙂", "🇨🇳", "👩🏽‍💻", "1️⃣", "©️", "𠮷", "\u0378"])("marks an unsupported complete grapheme locally: %s", async (grapheme) => {
    const typography = await getLocalOgTypography();
    expect(typography.formatText(`正文${grapheme}保留`)).toEqual({ text: "正文[?]保留", substituted: true });
    expect(blockedOutbound).not.toHaveBeenCalled();
  });

  it.each([
    { id: "exactly-126", input: "文".repeat(126), expected: "文".repeat(126), substituted: false },
    { id: "127-with-ellipsis", input: "文".repeat(127), expected: `${"文".repeat(125)}…`, substituted: false },
    { id: "100-emoji", input: "🙂".repeat(100), expected: `${"[?]".repeat(41)}…`, substituted: true },
    { id: "placeholder-fits-exactly", input: `${"A".repeat(123)}🙂`, expected: `${"A".repeat(123)}[?]`, substituted: true },
    { id: "placeholder-does-not-fit", input: `${"A".repeat(124)}🙂Z`, expected: `${"A".repeat(124)}…`, substituted: false },
    { id: "remove-whole-placeholder-for-ellipsis", input: `${"A".repeat(123)}🙂Z`, expected: `${"A".repeat(123)}…`, substituted: false },
    { id: "combining-grapheme-boundary", input: `${"A".repeat(124)}e\u0301Z`, expected: `${"A".repeat(124)}…`, substituted: false },
    { id: "whitespace", input: " \n正文\t 中文\n ", expected: "正文 中文", substituted: false },
  ])("truncates only complete original graphemes or placeholders: $id", async ({ input, expected, substituted }) => {
    const typography = await getLocalOgTypography();
    const result = typography.formatCardText(input);
    expect(result).toEqual({ text: expected, substituted });
    expectAtomicCardText(result.text);
    expect(blockedOutbound).not.toHaveBeenCalled();
  });

  it("renders a real Chinese/emoji PNG with no external fetch and leaves the confirmed body intact", async () => {
    const original = structuredClone(syntheticSignal);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(request(), context());
    const png = Buffer.from(await response.arrayBuffer());
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(findSignal.mock.calls).toEqual([[syntheticSignal.id], [syntheticSignal.id]]);
    expect(syntheticSignal).toEqual(original);
    expect(blockedOutbound).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  }, 15_000);

  it.each([
    { id: "long-chinese", text: "这是一段用于验证移动阅读的合成表达，需要完整显示并可以向下滚动。".repeat(30), substituted: false },
    { id: "long-emoji", text: "🙂".repeat(100), substituted: true },
    { id: "exact-chinese-budget", text: "文".repeat(126), substituted: false },
    { id: "unbroken-latin-budget", text: "W".repeat(126), substituted: false },
  ])("keeps the complete footer and safe text boundaries in a real PNG: $id", async ({ id, text, substituted }) => {
    const source = { ...syntheticSignal, expandedText: text };
    const original = structuredClone(source);
    findSignal.mockResolvedValue(source);
    const typography = await getLocalOgTypography();
    expectAtomicCardText(typography.formatCardText(text).text);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const png = Buffer.from(await (await GET(request(), context())).arrayBuffer());
    expect(source).toEqual(original);
    // Compare actual footer pixels to a short card with the same notice. A
    // matching blank crop alone would miss a footer that was hidden entirely.
    findSignal.mockResolvedValue({ ...syntheticSignal, expandedText: substituted ? "短文🙂" : "短文" });
    const reference = Buffer.from(await (await GET(request(), context())).arrayBuffer());
    const footer = { left: 76, top: 536, width: 1048, height: 40 };
    expect(await sharp(png).extract(footer).raw().toBuffer()).toEqual(await sharp(reference).extract(footer).raw().toBuffer());
    expect(await brightPixels(png, { left: 76, top: 536, width: 650, height: 40 })).toBeGreaterThan(200);
    expect(await brightPixels(png, { left: 108, top: 206, width: 1016, height: 282 })).toBeGreaterThan(1000);
    expect(await brightPixels(png, { left: 0, top: 0, width: 1200, height: 40 })).toBe(0);
    expect(await brightPixels(png, { left: 76, top: 500, width: 1048, height: 26 })).toBe(0);
    expect(await brightPixels(png, { left: 0, top: 590, width: 1200, height: 40 })).toBe(0);
    expect(findSignal).toHaveBeenCalledTimes(4);
    expect(blockedOutbound).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    if (id === "long-chinese" || id === "long-emoji") {
      const directory = new URL("../../../../../../../test-results/og-layout-20261101/", import.meta.url);
      await mkdir(directory, { recursive: true });
      await writeFile(new URL(`${id}.png`, directory), png);
    }
  }, 15_000);

  it.each([
    { id: "100-emoji", text: "🙂".repeat(100) },
    { id: "surrogate-and-placeholder-boundary", text: `${"A".repeat(124)}🙂Z` },
    { id: "mixed-long-body", text: "完整中文与 English 👩🏽‍💻，还有 e\u0301 和罕见字𠮷。".repeat(30) },
  ])("renders a bounded atomic snippet with real ImageResponse and zero network: $id", async ({ text }) => {
    const source = { ...syntheticSignal, expandedText: text };
    const original = structuredClone(source);
    findSignal.mockResolvedValue(source);
    const typography = await getLocalOgTypography();
    const prepared = typography.formatCardText(text);
    expectAtomicCardText(prepared.text);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(request(), context());
    const png = Buffer.from(await response.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(source).toEqual(original);
    expect(findSignal).toHaveBeenCalledTimes(2);
    expect(blockedOutbound).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  }, 15_000);

  it.each(["2", "1e0", "0"])("rejects an old or malformed public version before rendering: %s", async (version) => {
    await expect(GET(request(version), context())).rejects.toThrow("SYNTHETIC_OG_NOT_FOUND");
    expect(findSignal).toHaveBeenCalledTimes(1);
    expect(blockedOutbound).not.toHaveBeenCalled();
  });

  it("never renders an unavailable or private expression", async () => {
    findSignal.mockResolvedValueOnce(undefined);
    await expect(GET(request(), context())).rejects.toThrow("SYNTHETIC_OG_NOT_FOUND");
    expect(findSignal).toHaveBeenCalledTimes(1);
    expect(blockedOutbound).not.toHaveBeenCalled();
  });

  it.each([undefined, { ...syntheticSignal, publicationVersion: 4 }])("rejects a withdrawn or replaced version after real PNG rendering", async (current) => {
    findSignal.mockResolvedValueOnce(syntheticSignal).mockResolvedValueOnce(current);
    await expect(GET(request(), context())).rejects.toThrow("SYNTHETIC_OG_NOT_FOUND");
    expect(findSignal).toHaveBeenCalledTimes(2);
    expect(blockedOutbound).not.toHaveBeenCalled();
  }, 15_000);
});
