import { test, expect } from "@playwright/test";
import { login } from "./helpers";
import { ORIGIN, tokenPath } from "./env";

// Runs first on purpose: specs share one in-memory DB and this one expects a first-time check-in.

test("teacher shows QR, student checks in, awards publish", async ({ page, browser }) => {
  // Unauthenticated visitors are bounced to login and returned afterwards.
  await page.goto("/events");
  await expect(page).toHaveURL(/\/login\?next=%2Fevents/);
  await login(page, "teacher@demo.school");
  await expect(page).toHaveURL(/\/events$/);

  // Teacher fetches a live rotating token (what the projector QR encodes).
  const { token } = await (await page.request.get(tokenPath(1))).json();

  const student = await (await browser.newContext()).newPage();
  expect([401, 403]).toContain((await student.request.get(tokenPath(1))).status()); // not signed in
  await login(student, "student@demo.school");

  // Student opens the link the QR encodes (same as scanning with the phone camera).
  await student.goto(`/c/${token}`);
  await expect(student.getByRole("status")).toContainText("Checked in to Opening Assembly");
  await student.goto(`/c/${token}`);
  await expect(student.getByRole("status")).toContainText("Already checked in");
  await student.goto("/c/1.1.forged");
  await expect(student.getByRole("status")).toContainText("invalid");

  // Students cannot open the teacher portal.
  await student.goto("/admin");
  await expect(student).toHaveURL(`${ORIGIN}/`);

  // Teacher sees the attendee, then runs and publishes awards.
  await page.goto("/admin/events/1");
  await expect(page.getByText("Demo Student")).toBeVisible();
  await page.goto("/admin/awards");
  await page.click('button:has-text("Compute drafts")');
  await expect(page.getByText("Most Participation").first()).toBeVisible();
  await page.click('button:has-text("Publish to students")');
  await student.goto("/");
  await expect(student.getByText("Most Participation: #1")).toBeVisible();
});
