import { readFile } from "node:fs/promises";
import nodeModule from "node:module";
import { inflateSync } from "node:zlib";

// Node-only OG support. Resolve fixed, installed package assets rather than a
// request-controlled path or a URL. The runner includes these production fonts.
// Keep this a native runtime resolver. Webpack treats a directly imported
// createRequire(...).resolve(variable) as an empty build-time context instead.
// getBuiltinModule is available in our Node 22 images; the module default export
// preserves the existing older-Node fallback without resolving through cwd.
const nativeModule = typeof process.getBuiltinModule === "function"
  ? process.getBuiltinModule("node:module")
  : nodeModule;
const fontRequire = nativeModule.createRequire(import.meta.url);
const fontAssets = [
  { name: "Unfreq Sans", path: "@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff" },
  { name: "Unfreq Mono", path: "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff" },
] as const;

type LocalFont = { name: string; data: Buffer; weight: 400; style: "normal" };
export type OgCardText = { text: string; substituted: boolean };
type Typography = {
  fonts: LocalFont[];
  formatText(value: string): OgCardText;
  formatCardText(value: string): OgCardText;
};
let typography: Promise<Typography> | undefined;
const cardTextLimit = 126;

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
// Satori's emoji loader uses network image services, even when ordinary local
// fonts are present. Keep whole emoji/ZWJ/keycap sequences out of that loader.
const emojiSequence = new RegExp("[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\p{Regional_Indicator}\\p{Emoji_Modifier}\\u200D\\uFE0F\\u20E3]", "u");

function validFont(condition: boolean): void {
  if (!condition) throw new Error("Local OG font data is unavailable.");
}

// Read actual cmap coverage, not broad CSS unicode-range declarations: a CJK
// range can contain characters absent from this particular installed subset.
function glyphLookup(woff: Buffer): (codePoint: number) => boolean {
  validFont(woff.length >= 44 && woff.readUInt32BE(0) === 0x774f4646);
  const tableCount = woff.readUInt16BE(12);
  validFont(tableCount <= 256 && 44 + tableCount * 20 <= woff.length);
  let cmap: Buffer | undefined;
  for (let index = 0; index < tableCount; index += 1) {
    const entry = 44 + index * 20;
    if (woff.toString("ascii", entry, entry + 4) !== "cmap") continue;
    const offset = woff.readUInt32BE(entry + 4);
    const compressedLength = woff.readUInt32BE(entry + 8);
    const length = woff.readUInt32BE(entry + 12);
    validFont(length <= 4_000_000 && compressedLength <= length && offset + compressedLength <= woff.length);
    const bytes = woff.subarray(offset, offset + compressedLength);
    cmap = compressedLength < length ? inflateSync(bytes, { maxOutputLength: 4_000_000 }) : bytes;
    validFont(cmap.length === length);
    break;
  }
  validFont(cmap !== undefined && cmap.length >= 4);
  const data = cmap!;
  const encodingCount = data.readUInt16BE(2);
  validFont(4 + encodingCount * 8 <= data.length);
  const lookups: Array<(codePoint: number) => boolean> = [];
  for (let index = 0; index < encodingCount; index += 1) {
    const entry = 4 + index * 8;
    const platform = data.readUInt16BE(entry);
    const encoding = data.readUInt16BE(entry + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const offset = data.readUInt32BE(entry + 4);
    validFont(offset + 4 <= data.length);
    const format = data.readUInt16BE(offset);
    if (format === 4) {
      const length = data.readUInt16BE(offset + 2);
      validFont(length >= 16 && offset + length <= data.length);
      const table = data.subarray(offset, offset + length);
      const count = table.readUInt16BE(6) / 2;
      validFont(Number.isInteger(count) && 16 + count * 8 <= length);
      lookups.push((codePoint) => {
        if (codePoint > 0xffff) return false;
        for (let segment = 0; segment < count; segment += 1) {
          const end = table.readUInt16BE(14 + segment * 2);
          const start = table.readUInt16BE(16 + count * 2 + segment * 2);
          if (codePoint < start || codePoint > end) continue;
          const delta = table.readUInt16BE(16 + count * 4 + segment * 2);
          const rangePosition = 16 + count * 6 + segment * 2;
          const range = table.readUInt16BE(rangePosition);
          if (range === 0) return ((codePoint + delta) & 0xffff) !== 0;
          const glyphPosition = rangePosition + range + (codePoint - start) * 2;
          if (glyphPosition + 2 > table.length) return false;
          const glyph = table.readUInt16BE(glyphPosition);
          return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
        }
        return false;
      });
    } else if (format === 12) {
      validFont(offset + 16 <= data.length);
      const length = data.readUInt32BE(offset + 4);
      const count = data.readUInt32BE(offset + 12);
      validFont(count <= 65_536 && length >= 16 + count * 12 && offset + length <= data.length);
      lookups.push((codePoint) => {
        for (let group = 0; group < count; group += 1) {
          const position = offset + 16 + group * 12;
          const start = data.readUInt32BE(position);
          const end = data.readUInt32BE(position + 4);
          if (codePoint >= start && codePoint <= end) return data.readUInt32BE(position + 8) + codePoint - start !== 0;
        }
        return false;
      });
    }
  }
  validFont(lookups.length > 0);
  return (codePoint) => lookups.some((lookup) => lookup(codePoint));
}

export function getLocalOgTypography(): Promise<Typography> {
  typography ??= Promise.all(fontAssets.map(async (asset) => {
    const data = await readFile(fontRequire.resolve(asset.path));
    return { font: { name: asset.name, data, weight: 400, style: "normal" } satisfies LocalFont, hasGlyph: glyphLookup(data) };
  })).then((loaded) => {
    const hasGlyph = (character: string) => loaded.some((font) => font.hasGlyph(character.codePointAt(0)!));
    validFont(Array.from("[?]…").every(hasGlyph));
    const tokenFor = (segment: string): OgCardText =>
      !emojiSequence.test(segment) && Array.from(segment).every(hasGlyph)
        ? { text: segment, substituted: false }
        : { text: "[?]", substituted: true };
    const join = (tokens: OgCardText[]): OgCardText => ({
      text: tokens.map((token) => token.text).join(""),
      substituted: tokens.some((token) => token.substituted),
    });
    return {
      fonts: loaded.map((value) => value.font),
      formatText(value: string) {
        return join(Array.from(segmenter.segment(value), ({ segment }) => tokenFor(segment)));
      },
      formatCardText(value: string) {
        const tokens: OgCardText[] = [];
        let length = 0;
        for (const { segment } of segmenter.segment(value.replace(/\s+/g, " ").trim())) {
          const token = tokenFor(segment);
          if (length + token.text.length > cardTextLimit) {
            // Keep the existing 126-unit budget, including the ellipsis. Only
            // remove whole original graphemes/placeholders, never slice them.
            while (length > cardTextLimit - 1) length -= tokens.pop()!.text.length;
            const result = join(tokens);
            return { ...result, text: `${result.text}…` };
          }
          tokens.push(token);
          length += token.text.length;
        }
        return join(tokens);
      },
    };
  });
  return typography;
}
