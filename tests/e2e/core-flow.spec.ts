import { expect, test, type Page } from "playwright/test";

async function expectGalaxyCanvasReady(page: Page) {
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => {
      return canvas.evaluate((element) => {
        const canvasElement = element as HTMLCanvasElement;
        const context = canvasElement.getContext("webgl2") ?? canvasElement.getContext("webgl");
        const viewport = context?.getParameter(context.VIEWPORT) as Int32Array | undefined;

        return (
          canvasElement.width > 0 &&
          canvasElement.height > 0 &&
          (viewport?.[2] ?? 0) > 0 &&
          (viewport?.[3] ?? 0) > 0
        );
      });
    })
    .toBe(true);

  const canvasState = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const context = canvasElement.getContext("webgl2") ?? canvasElement.getContext("webgl");
    const viewport = context?.getParameter(context.VIEWPORT) as Int32Array | undefined;

    return {
      canvasHeight: canvasElement.height,
      canvasWidth: canvasElement.width,
      viewportHeight: viewport?.[3] ?? 0,
      viewportWidth: viewport?.[2] ?? 0,
    };
  });

  expect(canvasState.canvasWidth).toBeGreaterThan(0);
  expect(canvasState.canvasHeight).toBeGreaterThan(0);
  expect(canvasState.viewportWidth).toBeGreaterThan(0);
  expect(canvasState.viewportHeight).toBeGreaterThan(0);
}

test("galaxy route renders a nonblank webgl canvas directly", async ({ page }) => {
  await page.goto("/galaxy");

  await expect(page.getByRole("heading", { name: "共振星图" })).toBeVisible();
  await expect(page.getByText(/SIGNALS 002/)).toBeVisible();
  await expectGalaxyCanvasReady(page);
});

test("galaxy route renders a nonblank webgl canvas on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/galaxy");

  await expect(page.getByRole("heading", { name: "共振星图" })).toBeVisible();
  await expect(page.getByText(/SIGNALS 002/)).toBeVisible();
  await expectGalaxyCanvasReady(page);
});

test("my frequency route renders the logged-in frequency surface", async ({ page }) => {
  await page.goto("/me");

  await expect(page.getByText("FREQ.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "航行日志" })).toBeVisible();
  await expect(page.getByText("所有忙，都是不敢停下来面对空白。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "收藏发现" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2026-05 月度回顾" })).toBeVisible();
});

test("first visit can emit a seed and reach the galaxy", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("UNFREQ / FM 78.23")).toBeVisible();

  const seedInput = page.getByLabel("写下种子");
  await seedInput.fill("所有忙，都是不敢停下来面对空白。");
  await expect(page.getByText("016 / 200")).toBeVisible();

  await page.getByRole("button", { name: "发 射" }).click();

  await expect(page).toHaveURL(/\/result\/signal-core-001/);
  await expect(page.locator(".signal-expanded-reading").getByText("PRIVATE PREVIEW")).toBeVisible();
  await expect(page.getByText("忙碌像一层体面的噪声")).toBeVisible();
  await page.getByRole("button", { name: "确认发布" }).click();
  await expect(page.getByText("EXPANDED SIGNAL")).toBeVisible();
  await expect(page.getByText("SAME FREQUENCY")).toBeVisible();
  await expect(page.getByText("FM 21.04")).toBeVisible();

  await page
    .locator(".signal-action-section")
    .getByRole("link", { name: "进入星图" })
    .click();

  await expect(page).toHaveURL(/\/galaxy/);
  await expect(page.getByRole("heading", { name: "共振星图" })).toBeVisible();
  await expect(page.getByText(/SIGNALS 002/)).toBeVisible();

  await expectGalaxyCanvasReady(page);
});

test("generated signal can return to my frequency through the galaxy onboarding path", async ({ page }) => {
  await page.goto("/?onboarding=seed");

  await expect(page.getByText("把第一句话发向星海")).toBeVisible();

  await page.getByLabel("写下种子").fill("所有忙，都是不敢停下来面对空白。");
  await page.getByRole("button", { name: "发 射" }).click();

  await expect(page).toHaveURL(/\/result\/signal-core-001\?onboarding=result/);
  await expect(page.locator(".signal-expanded-reading").getByText("PRIVATE PREVIEW")).toBeVisible();
  await page.getByRole("button", { name: "确认发布" }).click();
  await expect(page.getByRole("heading", { name: "读回声里的自己" })).toBeVisible();
  await page
    .getByRole("status")
    .getByRole("link", { name: "进入星图" })
    .click();

  await expect(page).toHaveURL(/\/galaxy\?onboarding=galaxy/);
  await expect(page.getByText("走进信号星图")).toBeVisible();
  await page.getByRole("link", { name: "回到我的频率" }).click();

  await expect(page).toHaveURL(/\/me\?onboarding=complete/);
  await expect(page.getByText("第一轮信号已经落定")).toBeVisible();
  await expect(page.getByRole("heading", { name: "航行日志" })).toBeVisible();
  await expect(page.getByText("所有忙，都是不敢停下来面对空白。")).toBeVisible();
});

test("seed emission failure keeps the seed on the transmitter", async ({ page }) => {
  const failedSeed = "触发发射失败，但这句种子应该留在页面上。";

  await page.goto("/");

  const seedInput = page.getByLabel("写下种子");
  await seedInput.fill(failedSeed);
  await page.getByRole("button", { name: "发 射" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText("这句种子暂时没有发出。")).toBeVisible();
  await expect(seedInput).toHaveValue(failedSeed);
  await expect(page.getByText("020 / 200")).toBeVisible();
});
