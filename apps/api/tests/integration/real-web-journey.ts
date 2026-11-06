import { spawn } from "node:child_process";
import { get } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect, type Browser } from "playwright/test";
import type { IntegrationHarness } from "./harness.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const webOrigin = "http://127.0.0.1:3200";
const apiOrigin = "http://127.0.0.1:4200";

// This runs only in the browser-enabled managed integration job. No mock API,
// request interception, existing services or externally supplied URLs are used.
export async function runRealWebJourney(input: {
  harness: IntegrationHarness;
  author: { frequencyCode: string; password: string };
  adminCookie: string;
  waitForGenerationIdle: () => Promise<void>;
}): Promise<void> {
  const { harness: h } = input;
  const directory = join(dirname(process.env.UNFREQ_INTEGRATION_REPORT!), "browser");
  await mkdir(directory, { recursive: true });
  await h.app.listen({ host: "127.0.0.1", port: 4200 });
  const web = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "apps/web",
    "--hostname", "127.0.0.1", "--port", "3200"], {
    cwd: root, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", API_INTERNAL_BASE_URL: apiOrigin,
      NEXT_PUBLIC_API_BASE_URL: apiOrigin, NEXT_TELEMETRY_DISABLED: "1" },
  });
  let webClosed = false;
  let webError: Error | undefined;
  let webOutput = "";
  const exited = new Promise<void>((resolve) => { web.once("close", () => { webClosed = true; resolve(); }); });
  web.once("error", (error) => { webError = error; });
  const capture = (chunk: Buffer) => { webOutput = (webOutput + chunk.toString()).slice(-32_768); };
  web.stdout.on("data", capture); web.stderr.on("data", capture);
  let browser: Browser | undefined;
  const errors: unknown[] = [];
  const configIds: string[] = [];
  const originalFetch = globalThis.fetch;
  let readDispatches = 0;
  try {
    const readyDeadline = Date.now() + 30_000;
    while (true) {
      if (webError || webClosed) throw webError ?? new Error("Owned production Web exited before readiness.");
      const ready = await new Promise<boolean>((resolve) => {
        const request = get(`${webOrigin}/login`, (response) => { response.resume(); resolve(response.statusCode === 200); });
        request.on("error", () => resolve(false));
        request.setTimeout(500, () => { request.destroy(); resolve(false); });
      });
      if (ready) break;
      if (Date.now() >= readyDeadline) throw new Error("Owned production Web did not become ready.");
      await delay(100);
    }
    browser = await chromium.launch({ headless: true });
    const owner = await browser.newContext({ baseURL: webOrigin });
    const anonymous = await browser.newContext({ baseURL: webOrigin });
    await owner.tracing.start({ screenshots: true, snapshots: true });
    await anonymous.tracing.start({ screenshots: true, snapshots: true });
    const page = await owner.newPage();
    await page.goto("/login?returnTo=%2Fme");
    await page.getByLabel("FM", { exact: true }).fill(input.author.frequencyCode);
    await page.getByLabel("密码", { exact: true }).fill(input.author.password);
    await page.getByLabel("密码", { exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "航行日志" })).toBeVisible();
    expect((await owner.cookies()).find((cookie) => cookie.name === "unfreq_session")?.httpOnly).toBe(true);
    await page.goto("/");
    const privateSeed = "PRIVATE-REAL-BROWSER-SEED-今晚想把这段匿名信号留在这里。";
    await page.getByLabel("写下种子", { exact: true }).fill(privateSeed);
    const created = page.waitForResponse((response) => response.url() === `${apiOrigin}/api/signals` && response.request().method() === "POST");
    await page.getByRole("button", { name: /^发\s*射$/ }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const id = (await response.json()).data.signal.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page).toHaveURL(new RegExp(`/result/${id}(?:\\?|$)`), { timeout: 20_000 });
    await expect(page.getByRole("region", { name: "发布预览" })).toBeVisible();
    await input.waitForGenerationIdle();
    const [generated] = await h.sql`select generation_status, publication_version, publication_snapshot from signals where id = ${id}`;
    expect(generated).toMatchObject({ generation_status: "COMPLETED", publication_version: 0, publication_snapshot: null });
    expect((await anonymous.request.get(`${apiOrigin}/api/signals/${id}`)).status()).toBe(404);

    // Enable real stored configs after generation, then make every subsequent
    // API-process provider dispatch fail. Next SSR and Chromium use real HTTP.
    for (const kind of ["embedding", "reranker"]) {
      const config = await h.app.inject({ method: "POST", url: `/api/admin/provider-configs/${kind}`,
        headers: { cookie: input.adminCookie }, payload: { apiKey: "synthetic-browser-unavailable",
          baseUrl: `${h.provider.origin}/v1`, model: "synthetic", provider: "integration-unavailable", isEnabled: true } });
      expect(config.statusCode).toBe(201);
      configIds.push(config.json().data.providerConfig.id);
    }
    globalThis.fetch = async () => { readDispatches += 1; throw new Error("Synthetic matching unavailable during browser reads."); };
    const published = page.waitForResponse((result) => result.url().endsWith(`/${id}/publish`) && result.request().method() === "POST");
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    expect((await published).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "已公开", exact: true })).toBeVisible();
    await page.screenshot({ path: join(directory, "owner-public.png"), fullPage: true });
    const publicPage = await anonymous.newPage();
    for (let repeat = 0; repeat < 2; repeat += 1) {
      await publicPage.goto(`/result/${id}`);
      await expect(publicPage.getByText("PUBLIC SIGNAL", { exact: true })).toBeVisible();
      expect(await publicPage.content()).not.toContain(privateSeed);
      const detail = await anonymous.request.get(`${apiOrigin}/api/signals/${id}`);
      expect(detail.status()).toBe(200);
      const signal = (await detail.json()).data.signal;
      expect(signal.visibility).toBe("PUBLIC");
      expect(signal).not.toHaveProperty("seedText");
      // All pre-existing public controls here belong to this author, so they
      // cannot be presented as another person's discovery candidate.
      expect(signal.matches).toEqual([]);
      await expect(publicPage.getByText(/暂无合适同频/)).toBeVisible();
      expect((await anonymous.request.get(`${apiOrigin}/api/signals/${id}/matches`)).status()).toBe(200);
    }
    await publicPage.screenshot({ path: join(directory, "anonymous-public.png"), fullPage: true });

    // Exercise the real cross-origin PATCH from the administration UI. Direct
    // app.inject requests do not enforce the browser's CORS preflight policy.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "举报", exact: true }).click();
    const reportDialog = page.getByRole("dialog", { name: "举报这条信号" });
    const reportNote = "SYNTHETIC_BROWSER_PRIVATE_REPORT";
    await reportDialog.getByRole("textbox").fill(reportNote);
    const submittedReport = page.waitForResponse((result) => result.url() === `${apiOrigin}/api/reports` && result.request().method() === "POST");
    await reportDialog.getByRole("button", { name: "提交举报", exact: true }).click();
    const reportResponse = await submittedReport;
    expect(reportResponse.status()).toBe(201);
    const reportId = (await reportResponse.json()).data.report.id as string;
    await expect(reportDialog.getByText("举报状态：待审核", { exact: true })).toBeVisible();
    const administrator = await browser.newContext({ baseURL: webOrigin });
    await administrator.tracing.start({ screenshots: true, snapshots: true });
    await administrator.addCookies([{ name: "unfreq_session", value: input.adminCookie.slice("unfreq_session=".length),
      url: webOrigin, httpOnly: true, sameSite: "Lax" }]);
    const adminPage = await administrator.newPage();
    await adminPage.goto("/admin");
    await adminPage.getByRole("button", { name: /^举报队列 / }).click();
    const reportRow = adminPage.getByRole("row").filter({ hasText: reportNote });
    const resolvedReport = adminPage.waitForResponse((result) => result.url() === `${apiOrigin}/api/admin/reports/${reportId}` && result.request().method() === "PATCH");
    await reportRow.getByRole("button", { name: "驳回", exact: true }).click();
    expect((await resolvedReport).status()).toBe(200);
    await expect(adminPage.getByText("举报已驳回。", { exact: true })).toBeVisible();
    await reportDialog.getByRole("button", { name: "刷新处理状态", exact: true }).click();
    await expect(reportDialog.getByText("举报状态：未予处理", { exact: true })).toBeVisible();
    expect(await reportDialog.textContent()).not.toContain(reportNote);
    expect(await reportDialog.textContent()).not.toContain("未采纳这次举报。");
    await page.screenshot({ path: join(directory, "report-receipt-mobile.png"), fullPage: true });
    await reportDialog.getByRole("button", { name: "关闭举报", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    page.once("dialog", (dialog) => { void dialog.accept(); });
    await page.getByRole("button", { name: "撤回公开", exact: true }).click();
    await expect(page.getByRole("heading", { name: "已撤回公开", exact: true })).toBeVisible();
    expect((await anonymous.request.get(`${apiOrigin}/api/signals/${id}`)).status()).toBe(404);
    expect((await anonymous.request.get(`/api/og/${id}?v=1`)).status()).toBe(404);
    const hidden = await anonymous.request.get(`/result/${id}`);
    expect(await hidden.text()).not.toContain(privateSeed);
    await page.getByRole("button", { name: "确认重新发布", exact: true }).click();
    await expect(page.getByRole("heading", { name: "已公开", exact: true })).toBeVisible();
    await publicPage.reload();
    await expect(publicPage.getByText("PUBLIC SIGNAL", { exact: true })).toBeVisible();
    const [row] = await h.sql`select publication_version, withdrawn_at from signals where id = ${id}`;
    expect(row).toEqual({ publication_version: 3, withdrawn_at: null });
    expect(readDispatches).toBe(0);
    const deep = await anonymous.request.get(`${apiOrigin}/health/deep`);
    expect((await deep.json()).data.dependencies).toEqual({ postgres: "ok", redis: "ok" });
    await writeFile(join(directory, "journey.json"), JSON.stringify({ productionWeb: true, realApi: true,
      postgres: "ok", redis: "ok", syntheticProvider: true, publicationVersion: 3, readDispatches,
      browserAdminReportPatch: true, privateReportReceipt: true, passed: true }, null, 2));
  } catch (error) {
    errors.push(error);
  } finally {
    globalThis.fetch = originalFetch;
    for (const context of browser?.contexts() ?? []) {
      try { await context.tracing.stop({ path: join(directory, `trace-${browser!.contexts().indexOf(context)}.zip`) }); }
      catch (error) { errors.push(error); }
    }
    try { await browser?.close(); } catch (error) { errors.push(error); }
    if (!webClosed) web.kill("SIGTERM");
    await Promise.race([exited, delay(5_000)]);
    if (!webClosed) { web.kill("SIGKILL"); await Promise.race([exited, delay(2_000)]); }
    if (!webClosed) errors.push(new Error("Owned production Web did not exit during cleanup."));
    await writeFile(join(directory, "web.log"), webOutput);
    if (configIds.length !== 0) await h.sql`delete from provider_configs where id in ${h.sql(configIds)}`;
  }
  if (errors.length !== 0) throw new AggregateError(errors, "Real browser/API/PostgreSQL/Redis journey failed.");
}
