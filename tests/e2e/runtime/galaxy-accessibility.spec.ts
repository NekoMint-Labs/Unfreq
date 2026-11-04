import { expect, test } from "playwright/test";

test("public sample list opens a modal reader by keyboard and restores its trigger", async ({ page }) => {
  await page.goto("/galaxy");
  await page.getByRole("button", { name: "用列表阅读", exact: true }).click();
  const list = page.getByRole("region", { name: "公开信号列表" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  const trigger = list.getByRole("button").first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const reader = page.getByRole("dialog", { name: /信号阅读/ });
  await expect(reader).toBeVisible();
  await expect(reader.getByRole("button", { name: "关闭信号详情" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(reader.getByRole("button", { name: /隐 去/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reader.getByRole("button", { name: "关闭信号详情" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(reader).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("missing WebGL automatically presents the same public list and usable reader on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.startsWith("webgl") || type === "experimental-webgl") return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/galaxy");
  await expect(page.getByText("三维视图不可用，已切换到列表。", { exact: true })).toBeVisible();
  const list = page.getByRole("region", { name: "公开信号列表" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(page.locator("canvas")).toHaveCount(0);
  await list.getByRole("button").first().click();
  const reader = page.getByRole("dialog", { name: /信号阅读/ });
  await expect(reader).toBeVisible();
  const close = reader.getByRole("button", { name: "关闭信号详情" });
  expect((await close.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: test.info().outputPath("galaxy-list-mobile.png"), fullPage: true });
  await close.click();
  await expect(list.getByRole("button").first()).toBeFocused();
});

test("reduced motion stills the actual WebGL canvas and responds to live preference changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/galaxy");
  const host = page.locator(".galaxy-canvas-host");
  await expect(host).toHaveAttribute("data-graphics", "enabled");
  await expect(host).toHaveAttribute("data-motion", "reduced");
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(400);
  const first = await canvas.screenshot({ animations: "disabled" });
  await page.waitForTimeout(300);
  expect(await canvas.screenshot({ animations: "disabled" })).toEqual(first);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(host).toHaveAttribute("data-motion", "full");
  const moving = await canvas.screenshot({ animations: "disabled" });
  await page.waitForTimeout(400);
  expect(await canvas.screenshot({ animations: "disabled" })).not.toEqual(moving);
});
