import { expect, type Page } from "@playwright/test";

export const SHOTS = process.env.SHOTS_DIR ?? "test-results/shots";

export async function login(page: Page, email: string) {
  // Keep ?next= when the test was already redirected to the login page.
  if (!page.url().includes("/login")) await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="code"]', "DEMOCODE");
  await page.click('button:has-text("Sign in")');
  // First login in dev compiles pages, migrates and seeds the in-memory DB, so allow time.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
}

/** The Next dev-mode badge overlays the bottom nav and swallows clicks; it doesn't exist in production builds. */
export async function hideDevOverlay(page: Page) {
  await page.addInitScript(() => {
    const css = document.createElement("style");
    css.textContent = "nextjs-portal{display:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(css));
  });
}

/** Fails if the page scrolls horizontally (layout overflow on a phone). */
export async function expectNoHorizontalOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "horizontal overflow in px").toBeLessThanOrEqual(1);
}

/** Click a button that runs a server action and wait for that POST to finish, so later steps don't race it. */
export async function clickAndSave(page: Page, button: import("@playwright/test").Locator) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && r.ok()), button.click()]);
}
