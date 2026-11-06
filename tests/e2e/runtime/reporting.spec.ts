import { expect, test, type Locator, type Page } from "playwright/test";

async function expectCenteredDialog(page: Page, dialog: Locator) {
  const viewport = page.viewportSize()!;
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(16);
  expect(bounds!.y).toBeGreaterThanOrEqual(16);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 16);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 16);
  expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
}

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:4200/__runtime/reset");
});
test("anonymous report dialog asks for login and Escape restores its button", async ({ page }) => {
  await page.goto("/result/runtime-public-001");
  const trigger = page.getByRole("button", { name: "举报", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "举报这条信号" });
  await expect(dialog.getByRole("link", { name: "接入频率" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
test("mobile report submits a private receipt, retains it on reopen and traps keyboard focus", async ({ page, context }) => {
  await context.addCookies([{ name: "unfreq_session", value: "other", url: "http://127.0.0.1:3200", httpOnly: true, sameSite: "Lax" }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/result/runtime-public-001");
  const trigger = page.getByRole("button", { name: "举报", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "举报这条信号" });
  await expect(dialog.getByRole("button", { name: "提交举报" })).toBeEnabled();
  await expectCenteredDialog(page, dialog);
  const note = "SYNTHETIC_PRIVATE_REPORT_NOTE";
  await dialog.getByRole("textbox").fill(note);
  const submitted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/reports" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "提交举报" }).click();
  const response = await submitted;
  expect(response.status()).toBe(201);
  expect(await response.text()).not.toContain(note);
  await expect(dialog.getByText("举报状态：待审核", { exact: true })).toBeVisible();
  await expectCenteredDialog(page, dialog);
  expect(page.url()).not.toContain(note);
  const close = dialog.getByRole("button", { name: "关闭举报" });
  await close.focus(); await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "刷新处理状态" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("report-receipt-mobile.png"), fullPage: true });
  await close.click(); await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByText("举报状态：待审核", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "提交举报" })).toHaveCount(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await expectCenteredDialog(page, dialog);
});
