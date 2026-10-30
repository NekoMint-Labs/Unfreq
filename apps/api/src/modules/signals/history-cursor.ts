export type HistoryCursor = { createdAt: string; id: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function encodeHistoryCursor(value: HistoryCursor): string {
  return Buffer.from(JSON.stringify([1, value.createdAt, value.id])).toString("base64url");
}
export function decodeHistoryCursor(value: string): HistoryCursor | undefined {
  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return;
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return;
    const data = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(data) || data.length !== 3 || data[0] !== 1 || typeof data[1] !== "string" || typeof data[2] !== "string" || !uuid.test(data[2])) return;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(data[1]) || data[1].startsWith("0000-")) return;
    const milliseconds = data[1].replace(/(\.\d{3})\d{3}Z$/, "$1Z");
    if (new Date(milliseconds).toISOString() !== milliseconds) return;
    return { createdAt: data[1], id: data[2] };
  } catch { return; }
}
