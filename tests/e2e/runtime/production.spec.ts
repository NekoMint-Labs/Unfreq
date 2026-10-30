import { expect, test, type BrowserContext, type Locator, type Page } from "playwright/test";

const apiBaseUrl = `http://127.0.0.1:${process.env.RUNTIME_API_PORT ?? 4200}`;
const privateSeed = "PRIVATE-SEED-runtime-7a38";
const privateExpansion = "PRIVATE-EXPANSION-runtime-9b52";
const privatePath = "/result/runtime-private-001";
const publicPath = "/result/runtime-public-001";

async function signIn(context: BrowserContext, frequencyCode = "FM 78.23") {
  const response = await context.request.post(`${apiBaseUrl}/api/auth/frequency/login`, {
    data: { frequencyCode, password: "runtime-password" },
  });
  expect(response.status()).toBe(200);
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 18; count += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test.beforeEach(async ({ request }) => {
  // Reset only the loopback mock's synthetic state, including on repeat/retry.
  const reset = await request.post(`${apiBaseUrl}/__runtime/reset`);
  expect(reset.status()).toBe(200);
  expect((await reset.json()).data.synthetic).toBe(true);
});

async function expectDraftUnavailable(context: BrowserContext) {
  const deniedPage = await context.newPage();
  try {
    const response = await deniedPage.goto(privatePath);
    if (response === null) throw new Error("Draft navigation returned no response");
    // Next can stream a not-found page with HTTP 200 after headers are sent.
    // Require the real not-found UI and noindex rather than accepting any 200.
    expect([200, 404]).toContain(response.status());
    await expect(deniedPage.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await expect(deniedPage.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await expect(deniedPage.locator('meta[property="og:image"]')).toHaveCount(0);
    const html = await response.text();
    expect(html).not.toContain(privateSeed);
    expect(html).not.toContain(privateExpansion);
    await expect(deniedPage.getByRole("button", { name: "确认发布", exact: true })).toHaveCount(0);
  } finally {
    await deniedPage.close();
  }
}

test("FM login establishes a cookie that survives SSR navigation and reload", async ({ page, context }) => {
  await page.goto("/login?returnTo=%2Fme");
  await page.getByLabel("FM", { exact: true }).fill("FM 78.23");
  await page.getByLabel("密码", { exact: true }).fill("runtime-password");
  // Exercise native form validation too; do not bypass the real login flow.
  await expect.poll(() => page.getByLabel("FM", { exact: true }).evaluate(
    (input) => (input as HTMLInputElement).checkValidity(),
  )).toBe(true);
  await page.getByLabel("密码", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { name: "航行日志" })).toBeVisible();
  const cookie = (await context.cookies()).find((entry) => entry.name === "unfreq_runtime_session");
  expect(cookie?.httpOnly).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "航行日志" })).toBeVisible();
  const html = await context.request.get("/me");
  expect(html.status()).toBe(200);
  expect(await html.text()).toContain(privateSeed);
});

test("draft content stays private across SSR, metadata and OG until its author publishes", async ({ page, context, browser, baseURL }) => {
  await signIn(context);
  await page.goto(privatePath);
  await expect(page.getByText("PRIVATE PREVIEW", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(privateSeed, { exact: true })).toBeVisible();
  await expect(page.getByText("SHARE SIGNAL", { exact: true })).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  await expect(page).toHaveTitle("私密或未公开信号 | Unfreq");
  // Even an author's browser cookie must not make a public OG card of a draft.
  expect((await context.request.get("/api/og/runtime-private-001")).status()).toBe(404);

  const anonymous = await browser.newContext({ baseURL });
  const nonAuthor = await browser.newContext({ baseURL });
  try {
    await signIn(nonAuthor, "FM 21.04");
    for (const visitor of [anonymous, nonAuthor]) {
      await expectDraftUnavailable(visitor);
      expect((await visitor.request.get("/api/og/runtime-private-001")).status()).toBe(404);
      const galaxy = await visitor.request.get("/galaxy");
      expect(galaxy.status()).toBe(200);
      expect(await galaxy.text()).not.toContain(privateExpansion);
    }
    const rejectedPublish = await nonAuthor.request.post(`${apiBaseUrl}/api/signals/runtime-private-001/publish`, { data: {} });
    expect(rejectedPublish.status()).toBe(404);
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await expect(page.getByText("EXPANDED SIGNAL", { exact: true })).toBeVisible();
    const published = await anonymous.request.get(privatePath);
    expect(published.status()).toBe(200);
    expect(await published.text()).toContain(privateExpansion);
  } finally {
    await anonymous.close();
    await nonAuthor.close();
  }
});

test("public result provides a PNG OG card and a working copy-link action", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(publicPath);
  await expect(page.getByText("PUBLIC-RUNTIME-SIGNAL.", { exact: false }).first()).toBeVisible();
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content", `${baseURL}/api/og/runtime-public-001?v=1`,
  );
  const cardLink = page.getByRole("link", { name: "打开卡片", exact: true });
  await expect(cardLink).toHaveAttribute("href", `${baseURL}/api/og/runtime-public-001?v=1`);
  const imageResponse = await context.request.get("/api/og/runtime-public-001?v=1");
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toContain("image/png");
  const image = await imageResponse.body();
  expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(image.readUInt32BE(16)).toBe(1200);
  expect(image.readUInt32BE(20)).toBe(630);
  const popupPromise = page.waitForEvent("popup");
  await cardLink.click();
  const cardPage = await popupPromise;
  await expect(cardPage).toHaveURL(`${baseURL}/api/og/runtime-public-001?v=1`);
  await expect(cardPage.locator("img")).toBeVisible();
  await cardPage.close();
  await page.getByRole("button", { name: "复制链接", exact: true }).click();
  await expect(page.getByText("信号链接已经复制。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}${publicPath}`);
  expect((await context.request.get("/api/og/runtime-missing-001")).status()).toBe(404);
});

test("reporting supports keyboard submission, private status lookup and mobile focus restoration", async ({ page, context }, testInfo) => {
  await signIn(context, "FM 21.04");
  await page.goto(publicPath);
  const trigger = page.getByRole("button", { name: "举报", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "举报这条信号" });
  await expect(dialog).toBeVisible();
  const reason = dialog.getByLabel("举报原因");
  await expect(reason).toBeEnabled();
  await dialog.getByRole("button", { name: "关闭举报", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "提交举报", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "关闭举报", exact: true })).toBeFocused();
  await reason.focus();
  await page.keyboard.press("ArrowDown");
  await expect(reason).toHaveValue("垃圾信息或广告");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("textbox")).toBeFocused();
  await page.keyboard.type("SYNTHETIC_REVIEW_NOTE");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "提交举报", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("举报状态：待审核", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("c2-report-desktop.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.reload();
  await trigger.click();
  await expect(dialog.getByText("举报状态：待审核", { exact: true })).toBeVisible();
  await context.request.post(`${apiBaseUrl}/__runtime/resolve-reports`);
  await dialog.getByRole("button", { name: "刷新处理状态", exact: true }).click();
  await expect(dialog.getByText("举报状态：已处理", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("c2-report-mobile.png") });
  await dialog.getByRole("button", { name: "关闭举报", exact: true }).click();
  await expect(trigger).toBeFocused();
});

test("reporting provides safe login and rejected-submission feedback", async ({ page, context }) => {
  await page.goto(publicPath);
  await page.getByRole("button", { name: "举报", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "举报这条信号" });
  await expect(dialog.getByRole("link", { name: "接入频率", exact: true })).toHaveAttribute("href", "/login?returnTo=%2Fresult%2Fruntime-public-001");
  await dialog.getByRole("button", { name: "关闭举报", exact: true }).click();
  await signIn(context, "FM 21.04");
  await page.reload();
  await page.route("**/api/reports", async (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "synthetic" }, meta: { requestId: "test" } }) }));
  await page.getByRole("button", { name: "举报", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "提交举报", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "提交举报", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("操作过于频繁，请稍后再试。");
  await expect(dialog.getByRole("button", { name: "提交举报", exact: true })).toBeEnabled();
});

test("Galaxy reading exposes reporting without dismissing the selected signal", async ({ page, context }, testInfo) => {
  await context.request.post(`${apiBaseUrl}/__runtime/center-public-point`);
  await signIn(context, "FM 21.04");
  await page.goto("/galaxy");
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  // The synthetic signal is at scene origin; exercise actual canvas raycasting.
  await expect.poll(async () => {
    const bounds = await canvas.boundingBox();
    if (bounds) await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
    return page.getByRole("button", { name: "举报", exact: true }).isVisible();
  }).toBe(true);
  const report = page.getByRole("button", { name: "举报", exact: true });
  await report.click();
  const dialog = page.getByRole("dialog", { name: "举报这条信号" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "提交举报", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("c2-galaxy-report.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(report).toBeVisible();
  await expect(report).toBeFocused();
  await expect(page.getByRole("button", { name: "关闭信号详情", exact: true })).toBeVisible();
});

test("390px production Galaxy renders WebGL and navigates its frequency filter", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/galaxy");
  await expect(page.getByRole("heading", { name: "共振星图" })).toBeVisible();
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const context = canvasElement.getContext("webgl2") ?? canvasElement.getContext("webgl");
    const viewport = context?.getParameter(context.VIEWPORT) as Int32Array | undefined;
    return canvasElement.width > 0 && canvasElement.height > 0 && (viewport?.[2] ?? 0) > 0 && (viewport?.[3] ?? 0) > 0;
  })).toBe(true);
  await page.getByRole("navigation", { name: "星图主频段筛选" }).getByRole("link", { name: "关系星云", exact: true }).click();
  await expect(page).toHaveURL(/\/galaxy\?band=relationship_nebula$/);
  await expect(page.getByText(/符合筛选 1 · 返回样本 1 · 绘制 1/)).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("D1 keeps latest own and focused signals reachable within mobile and API sample budgets", async ({ page, context }, testInfo) => {
  await context.request.post(`${apiBaseUrl}/__runtime/large-galaxy`);
  await signIn(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/galaxy");
  await expect(page.getByText(/符合筛选 522 · 返回样本 80 · 绘制 72/)).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  const mobileBounds = await page.locator("canvas").first().boundingBox();
  expect(mobileBounds?.x).toBe(0);
  expect(mobileBounds?.width).toBe(390);
  await page.getByRole("button", { name: "找到我的信号", exact: true }).click();
  await expect(page.getByText("D1_BROWSER_519. A synthetic public expression.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭信号详情", exact: true }).click();
  await page.getByRole("button", { name: "查看样本列表", exact: true }).click();
  const list = page.getByRole("complementary", { name: "星图样本列表" });
  await expect(list.getByRole("listitem")).toHaveCount(80);
  await page.screenshot({ path: testInfo.outputPath("d1-mobile-list.png") });
  const target = list.getByRole("listitem").filter({ hasText: "D1_BROWSER_0." });
  await target.getByRole("link", { name: "在星图定位", exact: true }).click();
  await expect(page).toHaveURL(/focus=d1000000-0000-4000-8000-000000000000/);
  await expect(page.getByText("D1_BROWSER_0. A synthetic public expression.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭信号详情", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText(/返回样本 80 · 绘制 80/)).toBeVisible();
  const canvas = page.locator("canvas").first();
  await expect.poll(() => canvas.evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const gl = surface.getContext("webgl2") ?? surface.getContext("webgl");
    const viewport = gl?.getParameter(gl.VIEWPORT) as Int32Array | undefined;
    return surface.width > 0 && (viewport?.[2] ?? 0) > 0;
  })).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: testInfo.outputPath("d1-desktop-coverage.png") });
  await page.goto("/galaxy?band=relationship_nebula&focus=d1000000-0000-4000-8000-000000000519");
  await expect(page.getByRole("status")).toHaveText("指定信号当前不在可公开显示的筛选结果中。");
  await expect(page.getByRole("button", { name: "找到我的信号", exact: true })).toBeDisabled();
  expect(await page.locator("body").innerText()).not.toContain("D1_BROWSER_519");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test("D2 explains artistic positions, rule associations and decorative appearance", async ({ page, context }, testInfo) => {
  await page.goto("/galaxy");
  const legend = page.locator(".galaxy-legend");
  const summary = legend.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(legend).toHaveAttribute("open", "");
  await expect(legend.getByText(/位置是艺术化排布/)).toBeVisible();
  await expect(legend.getByText(/不代表真实人际关系/)).toBeVisible();
  await expect(legend.getByText(/不是相似度或排名/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("d2-legend-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(summary).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("d2-legend-mobile.png") });
  await summary.click();
  await expect(legend).not.toHaveAttribute("open", "");
  await context.request.post(`${apiBaseUrl}/__runtime/center-public-point`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/galaxy");
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => {
    const bounds = await canvas.boundingBox();
    if (bounds) await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
    return page.getByText("关联说明", { exact: true }).isVisible();
  }).toBe(true);
  await page.getByText("关联说明", { exact: true }).click();
  await expect(page.getByText("当前返回样本未列出与本条相关的规则候选。", { exact: true })).toBeVisible();
  await expect(page.getByText(/候选数不等于画面连线数/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("d2-association-note.png") });
});


test("D3 keyboard reading traps and restores focus, including a nested report", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/galaxy");
  const toggle = page.getByRole("button", { name: "查看样本列表", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const list = page.getByRole("complementary", { name: "星图样本列表" });
  const readerTrigger = list.locator(".galaxy-sample-read").first();
  await tabTo(page, readerTrigger);
  await page.keyboard.press("Enter");
  const reader = page.getByRole("dialog", { name: /信号阅读/ });
  await expect(reader).toBeVisible();
  const close = reader.getByRole("button", { name: "关闭信号详情" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(reader.getByRole("button", { name: /隐 去/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await tabTo(page, reader.getByRole("button", { name: /^我也想过/ }));
  await page.keyboard.press("Enter");
  await expect(reader.getByRole("status")).toContainText("共鸣已经送出");
  await tabTo(page, reader.getByRole("button", { name: "收藏", exact: true }));
  await page.keyboard.press("Enter");
  await expect(reader.getByRole("status").filter({ hasText: "信号已经收藏" })).toBeVisible();
  const report = reader.getByRole("button", { name: "举报", exact: true });
  await tabTo(page, report);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "举报这条信号" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reader).toBeVisible();
  await expect(report).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(reader).toHaveCount(0);
  await expect(readerTrigger).toBeFocused();
  await expect(list).toBeVisible();
  await expect(list).not.toContainText(privateSeed);
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
});

test("D3 WebGL creation failure leaves the same public sample readable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind.startsWith("webgl") || kind === "experimental-webgl") return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto("/galaxy");
  await expect(page.getByRole("status").filter({ hasText: "三维视图不可用" })).toBeVisible();
  const list = page.getByRole("complementary", { name: "星图样本列表" });
  await expect(list.locator(".galaxy-sample-read")).toHaveCount(2);
  await expect(list).not.toContainText(privateSeed);
  await tabTo(page, list.locator(".galaxy-sample-read").first());
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /信号阅读/ })).toContainText("PUBLIC-RUNTIME-SIGNAL");
  await page.keyboard.press("Escape");
  await expect(list.locator(".galaxy-sample-read").first()).toBeFocused();
});

test("D3 context loss opens list reading without losing the sample", async ({ page }) => {
  await page.goto("/galaxy");
  const canvas = page.locator(".galaxy-canvas-host canvas");
  await expect(canvas).toBeVisible();
  await canvas.evaluate((element) => element.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
  await expect(page.getByRole("status").filter({ hasText: "三维视图不可用" })).toBeVisible();
  await expect(page.locator(".galaxy-sample-read")).toHaveCount(2);
});

test("D3 reduced motion freezes the canvas and mobile long text stays readable at 200 percent text size", async ({ page, context }, testInfo) => {
  await context.request.post(`${apiBaseUrl}/__runtime/long-galaxy-expression`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/galaxy");
  const stage = page.locator(".galaxy-stage");
  await expect(stage).toHaveAttribute("data-motion", "reduced");
  const canvas = page.locator(".galaxy-canvas-host canvas");
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(1_000);
  const still = await canvas.screenshot({ animations: "disabled" });
  await page.waitForTimeout(500);
  const stillAfter = await canvas.screenshot({ animations: "disabled" });
  await testInfo.attach("reduced-before", { body: still, contentType: "image/png" });
  await testInfo.attach("reduced-after", { body: stillAfter, contentType: "image/png" });
  expect(Buffer.compare(still, stillAfter)).toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(stage).toHaveAttribute("data-motion", "full");
  const moving = await canvas.screenshot({ animations: "disabled" });
  await page.waitForTimeout(500);
  expect(Buffer.compare(moving, await canvas.screenshot({ animations: "disabled" }))).not.toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(stage).toHaveAttribute("data-motion", "reduced");
  await page.waitForTimeout(500);
  const stillAgain = await canvas.screenshot({ animations: "disabled" });
  await page.waitForTimeout(500);
  expect(Buffer.compare(stillAgain, await canvas.screenshot({ animations: "disabled" }))).toBe(0);
  await page.getByRole("button", { name: "关闭三维视图" }).click();
  await expect(canvas).toHaveCount(0);
  await page.locator(".galaxy-sample-read").first().click();
  const reader = page.getByRole("dialog", { name: /信号阅读/ });
  await expect(reader).toContainText("D3_LONG_END");
  await page.screenshot({ path: testInfo.outputPath("d3-reader-mobile.png") });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await reader.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await reader.locator(".galaxy-reader-scroll").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await reader.getByRole("button", { name: "举报", exact: true }).scrollIntoViewIfNeeded();
  await expect(reader.getByRole("button", { name: "关闭信号详情" })).toBeInViewport();
  for (const control of await reader.locator(".galaxy-sheet-actions button:visible,.galaxy-close-button").all()) {
    const rect = await control.boundingBox();
    expect(rect?.height).toBeGreaterThanOrEqual(44);
    expect(rect?.width).toBeGreaterThanOrEqual(44);
  }
  const contrast = await reader.evaluate((element) => {
    // Conservative background bound above the reader's dark gradient layers.
    const background = [44, 46, 56];
    const luminance = (rgb: number[]) => rgb.map((v) => {
      const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return Array.from(element.querySelectorAll(".galaxy-reading-text,.galaxy-sheet-tags,.galaxy-sheet-actions button,.galaxy-return-link,.galaxy-close-button")).filter((node) => node.getClientRects().length > 0).map((node) => {
      const values = getComputedStyle(node).color.match(/[\d.]+/g)!.map(Number);
      const alpha = values[3] ?? 1;
      const foreground = values.slice(0, 3).map((channel, index) => channel * alpha + background[index] * (1 - alpha));
      return (luminance(foreground) + 0.05) / (luminance(background) + 0.05);
    });
  });
  for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: testInfo.outputPath("d3-reader-mobile-text-200.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".galaxy-sample-read").first()).toBeFocused();
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator(".galaxy-sample-read").first().click();
  await expect(reader.getByRole("heading", { name: /信号阅读/ })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("d3-reader-desktop-long.png") });
});

test.describe("D4 request lifecycle and private history", () => {
test.use({ serviceWorkers: "block" });

test("D4 serializes slow polling and clears a recovered error before completion", async ({ page, context }) => {
  await signIn(context);
  const id = "d4000000-0000-4000-8000-000000000001";
  let calls = 0; let active = 0; let maximum = 0;
  await page.route(`${apiBaseUrl}/api/signals/${id}`, async (route) => {
    calls += 1; active += 1; maximum = Math.max(maximum, active);
    try {
      if (calls === 1) { await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "synthetic temporary failure" }, meta: { requestId: "d4" } } }); return; }
      await new Promise((resolve) => setTimeout(resolve, 2_700));
      await route.continue();
    } finally { active -= 1; }
  });
  await page.goto(`/signal/${id}/transmitting`);
  const pollingError = page.locator(".signal-transmitting-core").getByRole("alert");
  await expect(pollingError).toContainText("信号状态暂时没有返回");
  await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(3_300);
  expect(maximum).toBe(1);
  await expect(pollingError).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/signal/${id}/transmitting$`));
  await context.request.post(`${apiBaseUrl}/__runtime/d4-complete`);
  await expect(page).toHaveURL(new RegExp(`/result/${id}$`), { timeout: 15_000 });
  await expect(page.getByRole("region", { name: "发布预览" }).getByText("D4_SYNTHETIC_COMPLETE", { exact: true })).toBeVisible();
});

test("D4 login preserves continuation without putting private seed into returnTo", async ({ page }) => {
  const parent = "d4000000-0000-4000-8000-000000000002";
  const seed = "D4_PRIVATE_CONTINUATION 一句只用于续写测试的表达";
  await page.goto(`/?parentSignalId=${parent}&seed=${encodeURIComponent(seed)}`);
  await page.getByRole("link", { name: "创建或登录 FM" }).click();
  expect(page.url()).not.toContain("D4_PRIVATE_CONTINUATION");
  expect(page.url()).not.toContain(parent);
  await page.getByLabel("FM", { exact: true }).fill("FM 78.23");
  await page.getByLabel("密码", { exact: true }).fill("runtime-password");
  await page.getByLabel("密码", { exact: true }).press("Enter");
  await expect(page.getByRole("textbox", { name: "写下种子" })).toHaveValue(seed);
  const edited = `${seed}，继续保留编辑。`;
  await page.getByRole("textbox", { name: "写下种子" }).fill(edited);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "写下种子" })).toHaveValue(edited);
  const creation = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/signals"));
  await page.getByRole("button", { name: "发 射", exact: true }).click();
  expect((await creation).postDataJSON()).toEqual({ seedText: edited, parentSignalId: parent });
});

test("D4 owner continuation avoids content URLs and can clear its tab draft", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/result/d4000000-0000-4000-8000-000000000002");
  await page.getByRole("button", { name: "继续写 seed", exact: true }).click();
  await expect(page).toHaveURL(/\/\?continue=1$/);
  await expect(page.getByRole("textbox", { name: "写下种子" })).toHaveValue("D4_FOLLOW_UP_PRIVATE");
  expect(page.url()).not.toContain("D4_FOLLOW_UP_PRIVATE");
  await page.getByRole("button", { name: "清除续写", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "写下种子" })).toHaveValue("");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "写下种子" })).toHaveValue("");
});

test("D4 private history shows totals and the oldest top record across pages", async ({ page, context }, testInfo) => {
  await signIn(context);
  await context.request.post(`${apiBaseUrl}/__runtime/d4-history`);
  await page.goto("/me");
  await expect(page.getByText("历史最高共鸣 500", { exact: true })).toBeVisible();
  await expect(page.getByText("本页 80 条 · 全部 85 条", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "较早记录", exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.getByText("本页 5 条 · 全部 85 条", { exact: true })).toBeVisible();
  await expect(page.getByText("历史最高共鸣 500", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("d4-history-mobile.png"), fullPage: true });
});

test("D4 rejects an external login return target", async ({ page }) => {
  await page.goto("/login?returnTo=https%3A%2F%2Fevil.example%2Foutside");
  await page.getByLabel("FM", { exact: true }).fill("FM 78.23");
  await page.getByLabel("密码", { exact: true }).fill("runtime-password");
  await page.getByLabel("密码", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/me\?onboarding=login$/);
});

test("D4 pauses after repeated failures and resumes without creating another signal", async ({ page, context }) => {
  await signIn(context);
  const id = "d4000000-0000-4000-8000-000000000001";
  let calls = 0; let creations = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/api/signals")) creations += 1; });
  await page.route(`${apiBaseUrl}/api/signals/${id}`, async (route) => {
    calls += 1;
    await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "synthetic failure" }, meta: { requestId: "d4-stop" } } });
  });
  await page.goto(`/signal/${id}/transmitting`);
  const resume = page.getByRole("button", { name: "继续查询状态", exact: true });
  await expect(resume).toBeVisible({ timeout: 25_000 });
  expect(calls).toBe(4);
  await page.waitForTimeout(1_500);
  expect(calls).toBe(4);
  await page.unroute(`${apiBaseUrl}/api/signals/${id}`);
  await context.request.post(`${apiBaseUrl}/__runtime/d4-complete`);
  await resume.click();
  await expect(page).toHaveURL(new RegExp(`/result/${id}$`));
  expect(creations).toBe(0);
});

});

test("author withdrawal removes sharing and requires a fresh visible preview to republish", async ({ page, context, browser, baseURL }, testInfo) => {
  await signIn(context);
  await page.goto(privatePath);
  const preview = page.getByRole("region", { name: "发布预览" });
  await expect(preview.getByText(privateExpansion, { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("c1-preview-desktop.png"), fullPage: true, animations: "disabled" });
  const firstPublish = page.waitForRequest((request) => request.url().endsWith("/runtime-private-001/publish") && request.method() === "POST");
  await page.getByRole("button", { name: "确认发布", exact: true }).click();
  expect((await firstPublish).postDataJSON()).toMatchObject({ expectedVersion: 0, digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  await expect(page.getByRole("heading", { name: "已公开", exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "撤回公开", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已撤回公开", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("c1-withdrawn-mobile.png"), fullPage: true, animations: "disabled" });
  await expect(page.getByText(privateSeed, { exact: true })).toBeVisible();
  await expect(page.getByText("SHARE SIGNAL", { exact: true })).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  expect((await context.request.get("/api/og/runtime-private-001")).status()).toBe(404);
  const anonymous = await browser.newContext({ baseURL });
  try {
    await expectDraftUnavailable(anonymous);
    await expect(page.getByRole("heading", { name: "重新发布预览", exact: true })).toBeVisible();
    const republish = page.waitForRequest((request) => request.url().endsWith("/runtime-private-001/publish") && request.method() === "POST");
    await page.getByRole("button", { name: "确认重新发布", exact: true }).click();
    expect((await republish).postDataJSON()).toMatchObject({ expectedVersion: 2, digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await expect(page.getByRole("heading", { name: "已公开", exact: true })).toBeVisible();
    const restored = await anonymous.request.get(privatePath);
    const html = await restored.text();
    expect(html).toContain(privateExpansion);
    expect(html).not.toContain(privateSeed);
    expect((await anonymous.request.get("/api/og/runtime-private-001?v=1")).status()).toBe(404);
    const og = await anonymous.request.get("/api/og/runtime-private-001?v=3");
    expect(og.status()).toBe(200); expect(og.headers()["cache-control"]).toContain("no-store");
  } finally { await anonymous.close(); }
});


test("an already open public page does not read cached text aloud after withdrawal", async ({ context, browser, baseURL }) => {
  await signIn(context);
  const previewResponse = await context.request.get(`${apiBaseUrl}/api/signals/runtime-private-001/publication-preview`);
  const preview = (await previewResponse.json()).data.preview as { version: number; digest: string };
  expect((await context.request.post(`${apiBaseUrl}/api/signals/runtime-private-001/publish`, { data: { expectedVersion: preview.version, digest: preview.digest } })).status()).toBe(200);
  const anonymous = await browser.newContext({ baseURL });
  try {
    await anonymous.addInitScript(() => {
      const state = window as typeof window & { syntheticSpeechCount: number };
      state.syntheticSpeechCount = 0;
      Object.defineProperty(window.speechSynthesis, "speak", { value: () => { state.syntheticSpeechCount += 1; } });
    });
    const visitor = await anonymous.newPage();
    await visitor.goto(privatePath);
    await expect(visitor.getByText(privateExpansion, { exact: false }).first()).toBeVisible();
    expect((await context.request.post(`${apiBaseUrl}/api/signals/runtime-private-001/withdraw`, { data: { expectedVersion: 1 } })).status()).toBe(200);
    await visitor.getByRole("button", { name: "播放", exact: true }).click();
    await expect(visitor.getByText("这条信号暂不可播放。", { exact: true })).toBeVisible();
    expect(await visitor.evaluate(() => (window as typeof window & { syntheticSpeechCount: number }).syntheticSpeechCount)).toBe(0);
  } finally { await anonymous.close(); }
});


test("OG rejects a version that becomes withdrawn while its PNG is rendering", async ({ context }) => {
  const armed = await context.request.post(`${apiBaseUrl}/__runtime/revoke-after-first-public-read`);
  expect(armed.status()).toBe(200);
  expect((await context.request.get("/api/og/runtime-public-001?v=1")).status()).toBe(404);
  expect((await context.request.get(`${apiBaseUrl}/api/signals/runtime-public-001`)).status()).toBe(404);
});
