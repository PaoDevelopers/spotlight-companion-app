import { test, expect } from "@playwright/test";
import { SHOTS, hideDevOverlay, login } from "./helpers";

// Advance sign-up and the "no phone" check-in desk exist in the Go server only.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

test("students sign up; a teacher checks in a student who has no phone", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");

  // A rich event: markdown background, host, small capacity
  await page.goto("/admin/events/new");
  await page.fill('input[name="title"]', "Circuit Workshop");
  await page.fill('input[name="host"]', "Ms Chen");
  await page.fill('input[name="venue"]', "Lab 2");
  await page.fill('input[name="startsAt"]', "2099-03-01T15:00");
  await page.fill('input[name="capacity"]', "2");
  await page.fill('textarea[name="description"]', "Bring a **calculator**.");
  await page.getByRole("button", { name: "Bold" }).click(); // toolbar inserts markdown at the cursor
  await expect(page.getByRole("article", { name: "Preview" }).getByText("calculator")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/event-editor.png`, fullPage: true });
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/\d+$/);
  const eventId = page.url().split("/").pop();

  // Student signs up from their phone-sized screen
  const student = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await login(student, "student@demo.school");
  await student.goto(`/events/${eventId}`);
  await expect(student.getByText("Hosted by Ms Chen")).toBeVisible();
  await expect(student.locator("strong", { hasText: "calculator" })).toBeVisible();
  await expect(student.getByText("2 places left")).toBeVisible();
  await student.getByRole("button", { name: "Sign up" }).click();
  await expect(student.getByText("You're signed up")).toBeVisible();
  await student.screenshot({ path: `${SHOTS}/event-signup.png`, fullPage: true });

  // Teacher sees them expected; the student shows up without a phone and is found by name and checked in by hand
  await page.reload();
  await expect(page.getByText("Signed up, not here yet (1)")).toBeVisible();
  await page.fill('input[name="search"]', "Demo Student");
  await expect(page.getByRole("list", { name: "Search results" })).toContainText("Demo Student");
  await page.getByRole("button", { name: "Check in" }).first().click(); // the first one is the search result
  await expect(page.getByText("Checked in (1 / 2)")).toBeVisible();
  await expect(page.getByText("Signed up, not here yet (0)")).toBeVisible();

  // The paper sheet lists the signed-up student
  await page.goto(`/admin/events/${eventId}/sheet`);
  await expect(page.getByRole("heading", { name: /sign-in sheet/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Demo Student" })).toBeVisible();

  // On their own phone the student now sees they are checked in
  await student.reload();
  await expect(student.getByText("You're checked in")).toBeVisible();
  expect(errors).toEqual([]);
});
