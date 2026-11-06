import { expect, test } from "playwright/test";

test("report dialog closes independently inside the accessible Galaxy reader", async ({ page, context, request }) => {
  await request.post("http://127.0.0.1:4200/__runtime/reset");
  await context.addCookies([{ name: "unfreq_session", value: "other", url: "http://127.0.0.1:3200", httpOnly: true, sameSite: "Lax" }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/galaxy");
  await page.getByRole("button", { name: "用列表阅读", exact: true }).click();
  const list = page.getByRole("region", { name: "公开信号列表" });
  const trigger = list.getByRole("button").first();
  await trigger.click();
  const reader = page.getByRole("dialog", { name: /信号阅读/ });
  const reportTrigger = reader.getByRole("button", { name: "举报", exact: true });
  await reportTrigger.click();
  const report = page.getByRole("dialog", { name: "举报这条信号", exact: true });
  await expect(report.getByRole("button", { name: "提交举报" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(report).not.toBeVisible();
  await expect(reader).toBeVisible();
  await expect(reportTrigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(reader).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
