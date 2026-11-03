import { expect, test } from "playwright/test";
import { writeFile } from "node:fs/promises";

test("the complete Linux image serves assets and renders confirmed Chinese OG without external font requests", async ({ request, page, baseURL }) => {
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const initial = await request.get("/__image/identity");
  expect(initial.status()).toBe(200);
  expect(await initial.json()).toMatchObject({ syntheticOnly: true, blockedFetch: 0 });
  expect((await request.get("/web-health")).status()).toBe(200);
  const reset = await request.post("/__runtime/reset");
  expect(reset.status()).toBe(200);
  expect((await request.post("/__runtime/long-galaxy-expression")).status()).toBe(200);
  const image = await request.get("/api/og/runtime-public-001?v=1");
  expect(image.status()).toBe(200);
  expect(image.headers()["cache-control"]).toContain("no-store");
  const bytes = await image.body();
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
  await writeFile(test.info().outputPath("linux-image-chinese-og.png"), bytes);
  await page.goto("/");
  const assets = await page.locator('link[rel="stylesheet"], script[src]').evaluateAll((elements) => elements.map((element) =>
    element.getAttribute("href") ?? element.getAttribute("src")).filter((url): url is string => url !== null && url.startsWith("/_next/")));
  expect(assets.length).toBeGreaterThan(0);
  for (const asset of assets) expect((await request.get(asset)).status()).toBe(200);
  expect((await request.get("/sw.js")).status()).toBe(200);
  expect(await (await request.get("/__image/identity")).json()).toMatchObject({ blockedFetch: 0 });
  await page.screenshot({ path: test.info().outputPath("linux-image-home.png"), fullPage: true });
});

test("the Linux share route keeps confirmed emoji text intact while rendering local glyph placeholders", async ({ request }) => {
  expect((await request.post("/__runtime/reset")).status()).toBe(200);
  expect((await request.post("/__runtime/offline-og")).status()).toBe(200);
  const before = (await (await request.get("/api/signals/runtime-public-001")).json()).data.signal;
  expect(before.expandedText).toContain("🙂");
  const image = await request.get("/api/og/runtime-public-001?v=1");
  expect(image.status()).toBe(200);
  const bytes = await image.body();
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
  await writeFile(test.info().outputPath("linux-image-emoji-og.png"), bytes);
  const after = (await (await request.get("/api/signals/runtime-public-001")).json()).data.signal;
  expect(after.expandedText).toBe(before.expandedText);
  expect(after.publicationVersion).toBe(before.publicationVersion);
  expect(await (await request.get("/__image/identity")).json()).toMatchObject({ blockedFetch: 0 });
});
