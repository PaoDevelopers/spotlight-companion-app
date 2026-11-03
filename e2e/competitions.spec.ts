import { test, expect } from "@playwright/test";
import { SHOTS, hideDevOverlay, login } from "./helpers";

// Competition types (individual, team, house) are in the Go server only.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

async function newCompetitionEvent(page: import("@playwright/test").Page, title: string, kind: RegExp) {
  await page.goto("/admin/events/new");
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="startsAt"]', "2099-05-01T15:00");
  await page.getByLabel("This event is a competition").check();
  await page.getByRole("radio", { name: kind }).click();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/\d+$/);
  return page.url().split("/").pop()!;
}

test("team and house competitions: entry rules, results, and a readable leaderboard", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  const teamId = await newCompetitionEvent(page, "Robot Relay", /Teams/);
  const houseId = await newCompetitionEvent(page, "Sports Day", /Houses/);

  // the student must give a team name / pick a house
  const student = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await login(student, "student@demo.school");
  await student.goto(`/events/${teamId}`);
  await expect(student.getByRole("button", { name: "Register" })).toBeDisabled();
  await student.getByLabel("Team name").fill("The Quarks");
  await student.getByRole("button", { name: "Register" }).click();
  await expect(student.getByText("You're entered in the competition")).toBeVisible();
  await student.goto(`/events/${houseId}`);
  await expect(student.getByRole("button", { name: "Register" })).toBeDisabled();
  await student.getByRole("radio", { name: "Winter" }).click();
  await student.getByRole("button", { name: "Register" }).click();
  await expect(student.getByText("You're entered in the competition")).toBeVisible();

  // the teacher enters the second student by hand (no phone), then scores everyone
  await page.request.post("/api/admin/roster", { data: { csv: "name,email,class\nHand Added,hand@demo.school,9B" } });
  await page.goto("/admin/competitions");
  const sports = page.locator("section", { hasText: "Sports Day" });
  await sports.getByText("Add a student by hand").click();
  await sports.getByLabel("House").selectOption("Summer");
  await sports.getByPlaceholder("Search students by name or class…").fill("Demo Teacher");
  await expect(sports.getByText("No student matches")).toBeVisible(); // teachers are not students
  await sports.getByPlaceholder("Search students by name or class…").fill("Hand Added");
  await sports.getByRole("button", { name: "Add", exact: true }).click();
  await expect(sports.getByText("Hand Added")).toBeVisible();
  await expect(sports.getByText("Summer house")).toBeVisible();
  for (const [title, score, rank] of [["Robot Relay", "80", "1"], ["Sports Day", "40", "1"]] as const) {
    const card = page.getByRole("region", { name: title });
    const row = card.getByRole("row", { name: "Demo Student" });
    await row.locator('input[name="score"]').fill(score);
    await row.locator('input[name="rank"]').fill(rank);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "PUT" && r.ok()), card.getByRole("button", { name: /^Save 1 change/ }).click()]);
    await expect(card.getByRole("button", { name: "✓ All saved" })).toBeVisible();
  }
  await page.screenshot({ path: `${SHOTS}/results.png`, fullPage: true });

  // the leaderboard shows the team with members, and all four houses ranked
  await student.goto("/leaderboard");
  await expect(student.getByText("The Quarks")).toBeVisible();
  await expect(student.getByText("Winter house")).toBeVisible();
  for (const h of ["Spring", "Summer", "Autumn", "Winter"]) await expect(student.getByText(`${h} house`)).toBeVisible();
  await student.screenshot({ path: `${SHOTS}/leaderboard-phone.png`, fullPage: true });
  await expect(student.getByText("Robot Relay")).toBeVisible();
  await student.goto("/");
  await expect(student.getByText("team The Quarks")).toBeVisible();
  await expect(student.getByText("Winter house")).toBeVisible();

  // turning the competition off asks first, then removes it
  await page.goto(`/admin/events/${teamId}/edit`);
  await page.getByLabel("This event is a competition").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();
  await page.goto(`/admin/events/${teamId}`);
  await student.goto("/leaderboard");
  await expect(student.getByText("Robot Relay")).toHaveCount(0);
  expect(errors).toEqual([]);
});
