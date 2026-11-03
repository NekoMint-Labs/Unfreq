import { expect, test, type BrowserContext } from "playwright/test";

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
  const cookie = (await context.cookies()).find((entry) => entry.name === "unfreq_session");
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
  await expect(page.getByText(/SIGNALS 001/)).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
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


test("READY server audio plays and stops when browser speech synthesis is unavailable", async ({ page, context }, testInfo) => {
  const audioPath = "/api/signals/runtime-public-001/audio";
  const endpoint = `${apiBaseUrl}${audioPath}`;
  const mediaUrl = `${apiBaseUrl}${audioPath}/main?v=1`;
  const readable = await context.request.get(endpoint);
  expect(readable.status()).toBe(200);
  expect((await readable.json()).data.audio.audioStatus).toBe("NOT_REQUESTED");
  // Keep the real public fixture's read permission check. Only this case adds
  // a READY response and a valid silent PCM WAV; no TTS service is called.
  let readyRequests = 0;
  await context.route((url) => url.href === endpoint, async (route) => {
    const permission = await context.request.get(endpoint);
    if (permission.status() !== 200) {
      await route.fulfill({ response: permission });
      return;
    }
    readyRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" },
      body: JSON.stringify({ data: { audio: { signalId: "runtime-public-001", audioStatus: "READY", audioUrl: mediaUrl } },
        meta: { requestId: "synthetic-ready-audio" } }) });
  });
  const samples = 8000 * 10;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples, 40);
  let mediaRequests = 0;
  await context.route((url) => url.href === mediaUrl, async (route) => {
    mediaRequests += 1;
    await route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
  });
  await context.addInitScript(() => {
    const state = { playCalls: 0, pauseCalls: 0, utterances: 0, lastAudio: undefined as HTMLMediaElement | undefined };
    const probeWindow = window as typeof window & { syntheticAudioProbe: typeof state };
    probeWindow.syntheticAudioProbe = state;
    for (let target: object | null = window; target !== null; target = Object.getPrototypeOf(target) as object | null) {
      if (Object.prototype.hasOwnProperty.call(target, "speechSynthesis") && !Reflect.deleteProperty(target, "speechSynthesis")) {
        throw new Error("The controlled browser could not disable speech synthesis");
      }
    }
    if ("speechSynthesis" in window) throw new Error("Speech synthesis must be absent in this case");
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: function () {
      state.utterances += 1;
      throw new Error("This case must play the server WAV, not browser speech");
    } });
    const play = HTMLMediaElement.prototype.play;
    const pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      state.playCalls += 1;
      state.lastAudio = this;
      return play.call(this);
    };
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      state.pauseCalls += 1;
      return pause.call(this);
    };
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(publicPath);
  expect(await page.evaluate(() => "speechSynthesis" in window)).toBe(false);
  const requested = page.waitForRequest((request) => request.url() === endpoint && request.method() === "POST");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  expect((await requested).postDataJSON()).toEqual({});
  const stop = page.getByRole("button", { name: "停止播放", exact: true });
  await expect(stop).toBeEnabled();
  const readPlayback = () => page.evaluate(() => {
    const state = (window as typeof window & { syntheticAudioProbe: {
      playCalls: number; pauseCalls: number; utterances: number; lastAudio?: HTMLMediaElement;
    } }).syntheticAudioProbe;
    return { playCalls: state.playCalls, pauseCalls: state.pauseCalls, utterances: state.utterances,
      paused: state.lastAudio?.paused, currentSrc: state.lastAudio?.currentSrc, readyState: state.lastAudio?.readyState };
  });
  const playing = await readPlayback();
  expect(playing.playCalls).toBe(1);
  expect(playing.utterances).toBe(0);
  expect(playing.paused).toBe(false);
  expect(playing.currentSrc).toBe(mediaUrl);
  expect(playing.readyState).toBeGreaterThanOrEqual(2);
  expect(readyRequests).toBe(1);
  expect(mediaRequests).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("server-audio-without-speech-playing.png") });
  await stop.click();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  const stopped = await readPlayback();
  expect(stopped.paused).toBe(true);
  expect(stopped.pauseCalls).toBeGreaterThan(0);
  expect(stopped.playCalls).toBe(1);
  expect(stopped.utterances).toBe(0);
  await expect(page.getByRole("button", { name: "播放", exact: true }).locator("..").getByRole("alert")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
