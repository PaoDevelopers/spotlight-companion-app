import { test, expect } from "@playwright/test";
import { SHOTS, hideDevOverlay, login } from "./helpers";

// First-time-teacher experience: save states, unsaved-changes warning, exhibitions, dashboard, help, check-in status.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

test("save buttons say where things stand, and leaving with unsaved changes asks first", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");

  await page.goto("/admin/exhibits");
  await page.getByRole("link", { name: /Double Pendulum/ }).click();
  await page.getByRole("link", { name: "Edit exhibit" }).click();

  const save = (name: string) => page.getByRole("button", { name });
  await expect(save("No changes to save")).toBeDisabled(); // nothing changed yet

  await page.fill('input[name="summary"]', "Chaos you can see, today");
  await expect(save("Save changes")).toBeEnabled(); // something changed
  await save("Save changes").click();
  await expect(save("✓ Saved")).toBeDisabled(); // stored
  await page.fill('input[name="summary"]', "Chaos you can see");
  await expect(save("Save changes")).toBeEnabled(); // changed again
  await page.fill('input[name="summary"]', "Chaos you can see, today");
  await expect(save("✓ Saved")).toBeDisabled(); // back to exactly what was saved

  // an unsaved change: the menu asks before leaving, and "stay" really stays
  await page.fill('input[name="summary"]', "half typed");
  const asked: string[] = [];
  page.once("dialog", (d) => { asked.push(d.message()); d.dismiss(); });
  await page.getByRole("link", { name: "Events", exact: true }).click();
  expect(asked.join()).toContain("not saved");
  await expect(page).toHaveURL(/\/admin\/exhibits\/\d+\/edit$/);
  await expect(page.locator('input[name="summary"]')).toHaveValue("half typed");
  // the Back button asks too
  page.once("dialog", (d) => { asked.push(d.message()); d.dismiss(); });
  await page.getByRole("button", { name: /Back/ }).click();
  expect(asked.length).toBe(2);
  await expect(page).toHaveURL(/\/edit$/);
  // agreeing leaves
  page.once("dialog", (d) => d.accept());
  await page.getByRole("link", { name: "Events", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/events$/);
  // and after saving, leaving is silent
  await page.goto("/admin/exhibits");
  await page.getByRole("link", { name: /Double Pendulum/ }).click();
  await page.getByRole("link", { name: "Edit exhibit" }).click();
  await page.fill('input[name="summary"]', "Chaos you can see");
  await save("Save changes").click();
  await expect(save("✓ Saved")).toBeVisible();
  let surprised = false;
  page.on("dialog", (d) => { surprised = true; d.dismiss(); });
  await page.getByRole("link", { name: "Events", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/events$/);
  expect(surprised).toBe(false);
  expect(errors).toEqual([]);
});

test("exhibitions group the exhibits, for teachers and for students", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");

  // an exhibition for physics and one for chemistry
  for (const [name, subject, summary] of [["Physics Exhibition", "Physics", "Forces and waves"], ["Chemistry Exhibition", "Chemistry", "Reactions"]] as const) {
    await page.goto("/admin/exhibitions/new");
    await page.fill('input[name="title"]', name);
    await page.getByRole("group", { name: "Subject" }).getByRole("button", { name: subject }).click();
    await page.fill('input[name="summary"]', summary);
    await page.fill('textarea[name="bodyMd"]', `Welcome to the ${name}.`);
    await page.getByRole("button", { name: "Create exhibition" }).click();
    await expect(page).toHaveURL(/\/admin\/exhibits$/);
  }
  await expect(page.getByRole("region", { name: "Chemistry Exhibition" })).toBeVisible();

  // "Add an exhibit here" opens the editor with that exhibition chosen, and its subject
  await page.getByRole("region", { name: "Chemistry Exhibition" }).getByRole("link", { name: "Add an exhibit here" }).click();
  await expect(page.getByRole("combobox", { name: "Exhibition" })).toHaveValue(/\d+/);
  await expect(page.getByRole("group", { name: "Subject" }).getByRole("button", { name: "Chemistry" })).toHaveAttribute("aria-pressed", "true");
  await page.fill('input[name="title"]', "Colour Change");
  await page.getByRole("button", { name: "Create exhibit" }).click();
  await expect(page).toHaveURL(/\/admin\/exhibits\/\d+$/);
  await expect(page.getByText("Part of")).toContainText("Chemistry Exhibition");

  // a physics exhibit chosen from the dropdown
  await page.goto("/admin/exhibits/new");
  await page.fill('input[name="title"]', "Pulley Wall");
  await page.getByRole("combobox", { name: "Exhibition" }).selectOption({ label: "Physics Exhibition (Physics)" });
  await page.getByRole("button", { name: "Create exhibit" }).click();
  await expect(page).toHaveURL(/\/admin\/exhibits\/\d+$/);
  await page.goto("/admin/exhibits");
  await expect(page.getByRole("region", { name: "Physics Exhibition" }).getByRole("link", { name: /Pulley Wall/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Chemistry Exhibition" }).getByRole("link", { name: /Colour Change/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Not in an exhibition" }).getByRole("link", { name: /Double Pendulum/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/exhibits-grouped-admin.png`, fullPage: true });

  // students see the groups, their introduction, and progress; the subject filter narrows it
  const student = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
  await login(student, "student@demo.school");
  await student.goto("/exhibits");
  const phys = student.getByRole("region", { name: "Physics Exhibition" });
  await expect(phys).toContainText("0 of 1 visited");
  await expect(phys.getByText("About this exhibition")).toBeVisible();
  await phys.getByText("About this exhibition").click();
  await expect(phys.getByText("Welcome to the Physics Exhibition.")).toBeVisible();
  await expect(student.getByRole("region", { name: "More installations" })).toBeVisible();
  await student.screenshot({ path: `${SHOTS}/exhibits-grouped-student.png`, fullPage: true });
  await student.getByRole("link", { name: "Chemistry", exact: true }).click();
  await expect(student.getByRole("region", { name: "Chemistry Exhibition" })).toBeVisible();
  await expect(student.getByRole("region", { name: "Physics Exhibition" })).toHaveCount(0);

  // deleting an exhibition keeps its exhibits
  await page.goto("/admin/exhibits");
  await page.getByRole("region", { name: "Physics Exhibition" }).getByRole("link", { name: "Edit exhibition" }).click();
  await page.getByRole("button", { name: "Delete this exhibition" }).click();
  await expect(page).toHaveURL(/\/admin\/exhibits$/);
  await expect(page.getByRole("region", { name: "Physics Exhibition" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Pulley Wall/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a teacher with no guidance: dashboard tasks, check-in status, results save state, help", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Teacher portal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "What would you like to do?" }).getByRole("link", { name: /Set up an event/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Next events" }).getByRole("link", { name: "Show check-in QR" }).first()).toBeVisible();
  await expect(page.getByText("Check-ins")).toBeVisible(); // the numbers are still there
  await page.screenshot({ path: `${SHOTS}/dashboard-teacher.png`, fullPage: true });

  // an event next year: the event page says check-in is not open and when it will be
  await page.goto("/admin/events/new");
  await page.fill('input[name="title"]', "Far Away Talk");
  await page.fill('input[name="startsAt"]', "2099-06-01T10:00");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/\d+$/);
  const status = page.getByRole("status").filter({ hasText: "Check-in is not open yet" });
  await expect(status).toContainText("one hour before the start");
  await expect(status).toContainText("check anyone in by hand");
  await page.screenshot({ path: `${SHOTS}/event-checkin-status.png` });

  // an event happening now: it says it is open
  const now = new Date();
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await page.goto("/admin/events/new");
  await page.fill('input[name="title"]', "Happening Now");
  await page.fill('input[name="startsAt"]', local(new Date(now.getTime() - 10 * 60000)));
  await page.getByRole("button", { name: "2 h" }).click();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Check-in is open" })).toBeVisible();

  // the nav uses plain words and the Help page explains the day
  const nav = page.getByRole("navigation", { name: "Teacher portal" });
  await expect(nav.getByRole("link", { name: "Results" })).toBeVisible();
  await nav.getByRole("link", { name: "Help" }).click();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  await page.getByText("On the day: checking students in").click();
  await expect(page.getByText("Check-in is open from one hour before the event starts until it ends.")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/help.png`, fullPage: true });

  // competition results: the row's button shows its own state
  await page.goto("/admin/events/new");
  await page.fill('input[name="title"]', "Quiz Night");
  await page.fill('input[name="startsAt"]', "2099-07-01T10:00");
  await page.getByLabel("This event is a competition").check();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/\d+$/);
  const comp = await page.request.get("/api/admin/competitions");
  const cid = (await comp.json()).competitions.find((c: { name: string }) => c.name === "Quiz Night").id;
  await page.request.post(`/api/admin/competitions/${cid}/entries`, { data: { userId: (await (await page.request.get("/api/admin/students?q=student@demo.school")).json())[0].id } });
  await page.goto("/admin/competitions");
  const card = page.getByRole("region", { name: "Quiz Night" });
  await expect(card.getByRole("button", { name: "No changes to save" })).toBeDisabled();
  await card.getByLabel("Score for Demo Student").fill("77");
  await expect(card.getByText("1 row has changes that are not saved yet")).toBeVisible();
  await card.getByRole("button", { name: "Save 1 change" }).click();
  await expect(card.getByRole("button", { name: "✓ All saved" })).toBeVisible();
  expect(errors).toEqual([]);
});
