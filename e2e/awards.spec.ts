import { test, expect } from "@playwright/test";
import { SHOTS, hideDevOverlay, login } from "./helpers";

// Teacher-chosen awards exist in the Go server only (the prototype computes them).
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

test("a teacher gives awards to chosen students with reasons; students see them after publishing", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  await page.request.post("/api/admin/roster", { data: { csv: "name,email,class\nLin Mei,lin@demo.school,9B" } });

  await page.goto("/admin/awards");
  await expect(page.getByText("No awards yet.")).toBeVisible();
  // nothing is calculated: there is no "compute", "judge score" or "veto"
  await expect(page.getByRole("button", { name: /compute|score|veto/i })).toHaveCount(0);

  const add = page.getByRole("button", { name: "Add award" });
  await expect(add).toBeDisabled(); // needs a title and a student
  await page.fill('input[name="title"]', "Most Creative Exhibit");
  await page.fill('input[name="search"]', "Demo Stu");
  await page.getByRole("list", { name: "Search results" }).getByRole("button", { name: "Choose" }).first().click();
  await page.fill('input[name="search"]', "Lin");
  await page.getByRole("list", { name: "Search results" }).getByRole("button", { name: "Choose" }).first().click();
  await expect(page.getByRole("list", { name: "Chosen students" }).getByRole("listitem")).toHaveCount(2);
  await page.fill('textarea[name="reason"]', "Built a working chain-reaction machine");
  await add.click();
  await expect(page.getByText(/Added “Most Creative Exhibit” for 2 students/)).toBeVisible();
  await expect(page.getByText("2 awards are still a draft")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/awards-drafts-manual.png`, fullPage: true });

  // a student sees nothing while it is a draft
  const student = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await login(student, "student@demo.school");
  await expect(student.getByText("Most Creative Exhibit")).toHaveCount(0);

  // edit one reason, publish, and the student sees the award with the reason
  await page.getByRole("button", { name: "Publish all drafts" }).click();
  await expect(page.getByText("No drafts waiting.")).toBeVisible();
  await student.goto("/");
  await expect(student.getByText("🏆 Most Creative Exhibit")).toBeVisible();
  await expect(student.getByText("Built a working chain-reaction machine")).toBeVisible();
  await student.screenshot({ path: `${SHOTS}/awards-student-home.png`, fullPage: true });

  // the Board lists the award for everyone, without a private student's name or reason
  await student.goto("/leaderboard");
  await expect(student.getByText("🏆 Most Creative Exhibit")).toBeVisible();
  await expect(student.getByText("Demo Student")).toHaveCount(0);

  // hide it again, and remove one student
  await page.getByRole("button", { name: "Hide" }).click();
  await student.goto("/");
  await expect(student.getByText("Most Creative Exhibit")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText("🏆 Most Creative Exhibit (1)")).toBeVisible();
  expect(errors).toEqual([]);
});
