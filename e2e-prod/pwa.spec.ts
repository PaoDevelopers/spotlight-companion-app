import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { LOG } from "../playwright.prod.config";

test("manifest, icons, service worker and offline exhibit page work in the production build", async ({ page, context }) => {
  // Manifest + icons
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Spotlight Month", display: "standalone", start_url: "/" });
  for (const icon of manifest.icons) {
    const r = await page.request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  expect((await page.request.get("/sw.js")).status()).toBe(200);

  // First start creates the admin and logs a one-time code (triggered by any DB use)
  await page.goto("/login");
  await page.fill('input[name="email"]', "nobody@x.y");
  await page.fill('input[name="code"]', "WRONG");
  await page.click('button:has-text("Sign in")');
  await expect(page.getByText("Email or code not recognised.")).toBeVisible();
  const code = readFileSync(LOG, "utf8").match(/login code: (\w+)/)?.[1];
  expect(code, "admin bootstrap code in server log").toBeTruthy();
  await page.fill('input[name="email"]', "boss@school.edu");
  await page.fill('input[name="code"]', code!);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));

  // Create an exhibit, then view it so the service worker caches it
  await page.goto("/admin/exhibits");
  await page.fill('input[name="title"]', "Offline Demo");
  await page.fill('textarea[name="bodyMd"]', "## Works offline\nCached after one visit.");
  await page.getByRole("button", { name: "Save exhibit" }).click();
  await expect(page.getByText("Offline Demo").first()).toBeVisible();

  await page.goto("/exhibits/offline-demo");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the worker
  await expect(page.getByRole("heading", { name: "Works offline" })).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  // Offline: cached exhibit opens, uncached pages fail instead of showing stale personal data
  await context.setOffline(true);
  await page.goto("/exhibits/offline-demo");
  await expect(page.getByRole("heading", { name: "Works offline" })).toBeVisible();
  await expect(page.goto("/events")).rejects.toThrow();
  await context.setOffline(false);
});
