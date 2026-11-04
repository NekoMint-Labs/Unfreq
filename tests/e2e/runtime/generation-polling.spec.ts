import { expect, test, type BrowserContext } from "playwright/test";

test.use({ serviceWorkers: "block" });
const apiOrigin = "http://127.0.0.1:4200";
const path = "/api/signals/runtime-created-001";
async function pending(context: BrowserContext) {
  await context.addCookies([{ name: "unfreq_session", value: "owner", url: apiOrigin, httpOnly: true, sameSite: "Lax" }]);
  const result = await context.request.post(`${apiOrigin}/api/signals`, { data: { seedText: "D4 synthetic pending seed" } });
  expect(result.status()).toBe(200);
  return result.json();
}

test("slow polling never overlaps and recovery clears the error before unmount stops requests", async ({ page, context }) => {
  const response = await pending(context);
  let active = 0; let maximum = 0; let calls = 0;
  await context.route(`${apiOrigin}${path}`, async (route) => {
    calls += 1; active += 1; maximum = Math.max(maximum, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      await route.fulfill({ status: calls === 1 ? 503 : 200, contentType: "application/json",
        body: JSON.stringify(calls === 1 ? { error: { code: "AI_UNAVAILABLE", message: "Synthetic transient error" } } : response),
        headers: { "access-control-allow-origin": "http://127.0.0.1:3200", "access-control-allow-credentials": "true" } });
    } finally { active -= 1; }
  });
  await page.goto("/signal/runtime-created-001/transmitting");
  const error = page.locator(".signal-transmitting-core [role=alert]");
  await expect(error).toHaveText("信号状态暂时没有返回。");
  await expect(error).toHaveCount(0, { timeout: 10_000 });
  expect(maximum).toBe(1);
  await page.goto("/");
  const stoppedAt = calls;
  await page.waitForTimeout(2000);
  expect(calls).toBe(stoppedAt);
});

test("four failed reads pause and continuing reads the same signal without creating another", async ({ page, context }) => {
  const response = await pending(context);
  let calls = 0; let fail = true; let creates = 0;
  page.on("request", (request) => { if (request.url() === `${apiOrigin}/api/signals` && request.method() === "POST") creates += 1; });
  await context.route(`${apiOrigin}${path}`, (route) => {
    calls += 1;
    return route.fulfill({ status: fail ? 503 : 200, contentType: "application/json", body: JSON.stringify(fail ?
      { error: { code: "AI_UNAVAILABLE", message: "Synthetic unavailable read" } } : response),
      headers: { "access-control-allow-origin": "http://127.0.0.1:3200", "access-control-allow-credentials": "true" } });
  });
  await page.goto("/signal/runtime-created-001/transmitting");
  const resume = page.getByRole("button", { name: "继续查询状态", exact: true });
  await expect(resume).toBeVisible({ timeout: 22_000 });
  expect(calls).toBe(4);
  await page.waitForTimeout(1500);
  expect(calls).toBe(4);
  fail = false;
  await resume.click();
  await expect(page.locator(".signal-transmitting-core [role=alert]")).toHaveCount(0);
  await expect.poll(() => calls).toBe(5);
  expect(creates).toBe(0);
  await page.goto("/");
});
