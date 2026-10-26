import { test, expect } from "@playwright/test";
import { SHOTS, expectNoHorizontalOverflow, hideDevOverlay, login } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("student pages render and work at phone size", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));

  await hideDevOverlay(page);
  await login(page, "student@demo.school");
  const shot = (n: string) => page.screenshot({ path: `${SHOTS}/student-${n}.png`, fullPage: true });

  // Home
  await expect(page.getByRole("heading", { name: /Hi Demo/ })).toBeVisible();
  await expectNoHorizontalOverflow(page); await shot("home");

  // Events list + filter
  await page.getByRole("link", { name: "Events", exact: true }).click();
  await expect(page.getByText("Hackathon").first()).toBeVisible();
  await page.getByRole("link", { name: "Physics", exact: true }).click();
  await expect(page.getByText("Rube Goldberg Contest")).toBeVisible();
  await expect(page.getByText("Hackathon")).toHaveCount(0);
  await expectNoHorizontalOverflow(page); await shot("events");

  // Event detail with competition registration
  await page.goto("/events");
  await page.getByText("Hackathon").first().click();
  await expect(page.getByText("Competition: Hackathon")).toBeVisible();
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByText("Registered for Hackathon")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(/Hackathon · registered/)).toBeVisible();
  await shot("event-detail");

  // Exhibits: markdown renders, vote toggles
  await page.getByRole("link", { name: "Exhibits", exact: true }).click();
  await page.getByText("Double Pendulum").click();
  await expect(page.getByRole("heading", { name: "What you're seeing" })).toBeVisible();
  await page.getByRole("button", { name: "Vote Most Creative" }).click();
  await expect(page.getByRole("button", { name: /Your creative vote/ })).toBeVisible();
  await expectNoHorizontalOverflow(page); await shot("exhibit");

  // Leaderboard hides name until opted in
  await page.goto("/leaderboard");
  await expect(page.getByText("Student, 10A").first()).toBeVisible();
  await expect(page.getByText("Demo Student")).toHaveCount(0);
  await page.goto("/me");
  await expect(page.getByRole("img", { name: "QR code" })).toBeVisible();
  await page.getByLabel("Show my name on public leaderboards").check();
  await page.getByRole("button", { name: "Save" }).click();
  await page.goto("/leaderboard");
  await expect(page.getByText("Demo Student").first()).toBeVisible();
  await expectNoHorizontalOverflow(page); await shot("leaderboard");
  await page.goto("/me"); await shot("me");

  // Scan page degrades gracefully with no camera
  await page.goto("/scan");
  await expect(page.getByPlaceholder("Or paste a code")).toBeVisible();
  await shot("scan");

  // Bottom nav is reachable on every tab
  for (const l of ["Home", "Events", "Scan", "Exhibits", "Board", "Me"]) {
    await page.getByRole("link", { name: l, exact: true }).click({ timeout: 10_000 });
    await page.waitForLoadState("load");
    await expect(page.getByRole("navigation")).toBeVisible();
  }
  expect(errors.filter((e) => !/getUserMedia|NotAllowed|NotFound|Permission|^401 \S+\/api\/me$/i.test(e))).toEqual([]);
});
