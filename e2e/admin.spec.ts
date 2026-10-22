import { test, expect } from "@playwright/test";
import { SHOTS, clickAndSave, hideDevOverlay, login } from "./helpers";

test.use({ viewport: { width: 1280, height: 900 } });

test("teacher portal: events, exhibits, competitions, awards, roster", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  const shot = (n: string) => page.screenshot({ path: `${SHOTS}/admin-${n}.png`, fullPage: true });

  // Dashboard: teachers don't get the admin-only role form
  await page.goto("/admin");
  await expect(page.getByText("Check-ins")).toBeVisible();
  await expect(page.getByText("Set a user's role")).toHaveCount(0);
  await shot("dashboard");

  // Create an event
  await page.goto("/admin/events");
  await page.fill('input[name="title"]', "Lab Open Night");
  await page.selectOption('select[name="subject"]', "physics");
  await page.fill('input[name="venue"]', "Lab 1");
  await page.fill('input[name="startsAt"]', "2026-11-20T18:00");
  await page.fill('input[name="endsAt"]', "2026-11-20T20:00");
  await page.fill('input[name="capacity"]', "30");
  await page.getByRole("button", { name: "Create event" }).click();
  const link = page.getByRole("link", { name: /Lab Open Night/ });
  await expect(link).toBeVisible();
  await shot("events");
  await link.click();
  await expect(page.getByRole("heading", { name: "Lab Open Night" })).toBeVisible();
  const eventId = Number(page.url().split("/").pop());

  // Manual add, CSV export, undo
  await page.fill('input[name="email"]', "student@demo.school");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Demo Student")).toBeVisible();
  const csv = await (await page.request.get(`/api/admin/events/${eventId}/csv`)).text();
  expect(csv.split("\n")[0]).toBe("name,class,method,time");
  expect(csv).toContain('"Demo Student","10A","manual"');
  await expect(page.getByText("NFC tag / printable QR")).toBeVisible();
  await expect(page.locator("code").first()).toContainText("/c/event.");
  await shot("event-detail");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Demo Student")).toHaveCount(0);

  // Edit the event
  await page.getByText("Edit event").click();
  await page.locator('details input[name="title"]').fill("Lab Open Night (updated)");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Lab Open Night (updated)" })).toBeVisible();

  // Exhibit with creator, printable QR
  await page.goto("/admin/exhibits");
  await page.fill('input[name="title"]', "Wave Tank");
  await page.fill('input[name="summary"]', "Ripples and interference");
  await page.fill('textarea[name="bodyMd"]', "## How it works\nWaves add up.");
  await page.fill('input[name="owners"]', "student@demo.school");
  await page.getByRole("button", { name: "Save exhibit" }).click();
  await expect(page.getByText("Wave Tank").first()).toBeVisible();
  await expect(page.locator("code", { hasText: "/c/exhibit." }).first()).toBeVisible();
  await shot("exhibits");

  // Competition: student registers, teacher records the result, student sees it
  await page.goto("/admin/competitions");
  await page.fill('input[name="name"]', "Physics Quiz");
  await page.locator('select[name="eventId"]').selectOption({ label: "Lab Open Night (updated)" });
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Physics Quiz" })).toBeVisible();

  const student = await (await browser.newContext()).newPage();
  await login(student, "student@demo.school");
  await student.goto(`/events/${eventId}`);
  await student.getByRole("button", { name: "Register" }).click();
  await expect(student.getByText("Registered for Physics Quiz")).toBeVisible();

  await page.goto("/admin/competitions");
  const row = page.locator("form", { hasText: "Demo Student" }).last();
  await row.locator('select[name="status"]').selectOption("finished");
  await row.locator('input[name="score"]').fill("95");
  await row.locator('input[name="rank"]').fill("1");
  await clickAndSave(page, row.getByRole("button", { name: "Save" }));
  await page.reload();
  await expect(page.locator('form:has-text("Demo Student") input[name="score"]').last()).toHaveValue("95");
  await shot("competitions");
  await student.goto("/");
  await expect(student.getByText(/Physics Quiz · finished · rank 1/)).toBeVisible();

  // Awards: judge score, compute drafts, veto with reason
  await page.goto("/admin/awards");
  const scoreForm = page.locator("form", { hasText: "Wave Tank" });
  await scoreForm.locator('input[name="score"]').fill("88");
  await clickAndSave(page, scoreForm.getByRole("button", { name: "Score" }));
  await clickAndSave(page, page.getByRole("button", { name: "Compute drafts" }));
  await expect(page.getByText("Most Creative").first()).toBeVisible();
  await shot("awards-drafts");
  const creative = page.locator("div", { hasText: /^Most Creative/ }).locator("form", { hasText: "Demo Student" }).first();
  await creative.locator('input[name="reason"]').fill("ineligible");
  await clickAndSave(page, creative.getByRole("button", { name: "Remove" }));
  await expect(page.locator("div", { hasText: /^Most Creative/ })).toHaveCount(0);

  // Roster import issues working codes
  await page.goto("/admin/roster");
  await page.fill("textarea", "name,email,class\nNew Kid,newkid@demo.school,9B");
  await page.getByRole("button", { name: /Import/ }).click();
  const code = (await page.locator("td.font-mono").first().textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);
  await shot("roster");
  const kid = await (await browser.newContext()).newPage();
  await kid.goto("/login");
  await kid.fill('input[name="email"]', "newkid@demo.school");
  await kid.fill('input[name="code"]', code.toLowerCase());
  await kid.click('button:has-text("Sign in")');
  await expect(kid.getByRole("heading", { name: "Hi New" })).toBeVisible({ timeout: 30_000 });

  // Delete the event
  await page.goto(`/admin/events/${eventId}`);
  await page.getByRole("button", { name: "Delete event" }).click();
  await expect(page).toHaveURL(/\/admin\/events$/);
  await expect(page.getByRole("link", { name: /Lab Open Night/ })).toHaveCount(0);

  expect(errors).toEqual([]);
});
