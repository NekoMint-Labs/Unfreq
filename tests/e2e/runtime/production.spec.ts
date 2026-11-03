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

test("FM credential forms stay disabled until hydration and then establish an SSR session", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  let releaseJavaScript = () => {};
  const javaScriptGate = new Promise<void>((resolve) => { releaseJavaScript = resolve; });
  let heldRequests = 0;
  let released = false;
  const staticJavaScript = /\/_next\/static\/.*\.js(?:\?.*)?$/;
  await context.route(staticJavaScript, async (route) => {
    if (new URL(route.request().url()).origin === origin && !released) {
      heldRequests += 1;
      await javaScriptGate;
    }
    await route.continue();
  });
  try {
    // Commit the actual SSR document while its client JavaScript remains held.
    // DOMContentLoaded would wait for those scripts and miss the unsafe window.
    await page.goto("/login?returnTo=%2Fme", { waitUntil: "commit" });
    const registerPassword = page.getByLabel("设置密码", { exact: true });
    const frequency = page.getByLabel("FM", { exact: true });
    const password = page.getByLabel("密码", { exact: true });
    const registerButton = page.getByRole("button", { name: "创建我的 FM 频率", exact: true });
    const loginButton = page.getByRole("button", { name: "FM 登录", exact: true });
    await expect(registerPassword).toBeVisible();
    await expect.poll(() => heldRequests).toBeGreaterThan(0);
    for (const control of [registerPassword, frequency, password, registerButton, loginButton]) {
      await expect(control).toBeDisabled();
    }
    for (const credential of [registerPassword, password]) {
      await expect(page.locator("form").filter({ has: credential })).toHaveAttribute("method", "post");
    }
    released = true;
    releaseJavaScript();
    for (const control of [registerPassword, frequency, password, registerButton, loginButton]) {
      await expect(control).toBeEnabled();
    }
    await frequency.fill("FM 78.23");
    await password.fill("runtime-password");
    const loginResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/auth/frequency/login" && response.request().method() === "POST";
    });
    await loginButton.click();
    expect((await loginResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole("heading", { name: "航行日志" })).toBeVisible();
    expect((await context.cookies()).find((cookie) => cookie.name === "unfreq_session")?.httpOnly).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "航行日志" })).toBeVisible();
    const ssr = await context.request.get("/me");
    expect(ssr.status()).toBe(200);
    expect(await ssr.text()).toContain(privateSeed);
  } finally {
    released = true;
    releaseJavaScript();
    await context.unroute(staticJavaScript);
  }
});

test("home composer waits for hydration before accepting a seed and posting its bound value", async ({ page, context, baseURL }) => {
  await signIn(context);
  const origin = new URL(baseURL!).origin;
  let releaseJavaScript = () => {};
  const javaScriptGate = new Promise<void>((resolve) => { releaseJavaScript = resolve; });
  let heldRequests = 0;
  let released = false;
  const staticJavaScript = /\/_next\/static\/.*\.js(?:\?.*)?$/;
  await context.route(staticJavaScript, async (route) => {
    if (new URL(route.request().url()).origin === origin && !released) {
      heldRequests += 1;
      await javaScriptGate;
    }
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    const seedInput = page.getByLabel("写下种子", { exact: true });
    const submitButton = page.getByRole("button", { name: /^发\s*射$/ });
    const randomButton = page.getByRole("button", { name: /^漫\s*游$/ });
    const counter = page.locator(".home-void-count");
    await expect(seedInput).toBeVisible();
    await expect.poll(() => heldRequests).toBeGreaterThan(0);
    for (const control of [seedInput, submitButton, randomButton]) await expect(control).toBeDisabled();
    await expect(page.locator("form").filter({ has: seedInput })).toHaveAttribute("method", "post");
    await expect(counter).toHaveText("000 / 200");
    released = true;
    releaseJavaScript();
    await expect(seedInput).toBeEnabled();
    await expect(randomButton).toBeEnabled();
    await expect(submitButton).toBeDisabled();
    const seed = "HYDRATED_HOME_SYNTHETIC_SEED";
    await seedInput.fill(seed);
    await expect(seedInput).toHaveValue(seed);
    await expect(counter).toHaveText(`${seed.length.toString().padStart(3, "0")} / 200`);
    await expect(submitButton).toBeEnabled();
    const createResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/signals" && response.request().method() === "POST";
    });
    await submitButton.click();
    const created = await createResponse;
    // The existing loopback Web fixture returns 200; real API acceptance checks 201 separately.
    expect(created.status()).toBe(200);
    expect(created.request().postDataJSON()).toEqual({ seedText: seed });
    const accepted = await created.json();
    expect(accepted.data.signal.seedText).toBe(seed);
    expect(accepted.data.signal.visibility).toBe("GENERATION_OWNER");
    const signalId = accepted.data.signal.id;
    await expect(page).toHaveURL((url) =>
      url.pathname === `/signal/${signalId}/transmitting` || url.pathname === `/result/${signalId}`);
  } finally {
    released = true;
    releaseJavaScript();
    await context.unroute(staticJavaScript);
  }
});

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
  await expect(page).toHaveTitle("信号待发布 | Unfreq");
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
    "content", `${baseURL}/api/og/runtime-public-001`,
  );
  const cardLink = page.getByRole("link", { name: "打开卡片", exact: true });
  await expect(cardLink).toHaveAttribute("href", `${baseURL}/api/og/runtime-public-001`);
  const imageResponse = await context.request.get("/api/og/runtime-public-001");
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toContain("image/png");
  const image = await imageResponse.body();
  expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(image.readUInt32BE(16)).toBe(1200);
  expect(image.readUInt32BE(20)).toBe(630);
  const popupPromise = page.waitForEvent("popup");
  await cardLink.click();
  const cardPage = await popupPromise;
  await expect(cardPage).toHaveURL(`${baseURL}/api/og/runtime-public-001`);
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
