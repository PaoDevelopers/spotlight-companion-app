import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { SHOTS, hideDevOverlay, login } from "./helpers";

// "View as a student" and the clearer check-in message exist in the Go server only.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

const ADMIN = "view.as.admin@ykpaoschool.cn"; // the address the test server lists in IMPERSONATE_EMAILS

/** A throwaway admin: imported through the roster (which gives a login code), then promoted in the test's own database. */
async function makeAdmin(teacher: import("@playwright/test").Page) {
  const r = await teacher.request.post("/api/admin/roster", { data: { csv: `name,email,class\nTest Admin,${ADMIN},\n` } });
  const code = (await r.json()).issued[0].code as string;
  const db = new DatabaseSync(process.env.E2E_DB!);
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(ADMIN);
  db.close();
  return code;
}

test("an allowed admin views the app as a student, with a banner, and exits back", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  const code = await makeAdmin(page);

  // an ordinary teacher is never offered it
  await page.goto("/admin");
  await expect(page.getByText("View the app as a student")).toHaveCount(0);

  const admin = await (await browser.newContext()).newPage();
  await admin.goto("/login");
  await admin.fill('input[name="email"]', ADMIN);
  await admin.fill('input[name="code"]', code);
  await admin.click('button:has-text("Sign in")');
  await admin.waitForURL((u) => !u.pathname.startsWith("/login"));
  await admin.goto("/admin");
  await expect(admin.getByText("View the app as a student")).toBeVisible();
  await admin.fill('input[name="viewas"]', "Demo Stu");
  await admin.getByRole("list", { name: "Students to view as" }).getByRole("button", { name: "View as" }).first().click();

  // now the app is the student's, with a banner that says so
  await expect(admin).toHaveURL(/\/$/);
  await expect(admin.getByRole("heading", { name: "Hi Demo" })).toBeVisible();
  const banner = admin.getByRole("status").filter({ hasText: "Viewing as" });
  await expect(banner).toContainText("Demo Student");
  await expect(banner).toContainText("Test Admin");
  await expect(admin.getByRole("link", { name: "Teacher portal" })).toHaveCount(0); // a student has no portal
  await admin.screenshot({ path: `${SHOTS}/view-as-student.png`, fullPage: true });
  await admin.goto("/admin"); // admin pages are not available while looking as a student
  await expect(admin).toHaveURL(/\/$/);
  await admin.goto("/events");
  await expect(banner).toBeVisible(); // the banner follows every student page

  // exit: back to being the admin
  await banner.getByRole("button", { name: "Exit" }).click();
  await expect(admin).toHaveURL(/\/admin$/);
  await expect(admin.getByText("View the app as a student")).toBeVisible();
  await admin.goto("/");
  await expect(admin.getByText("Viewing as")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a closed check-in says why and when it opens", async ({ page, browser }) => {
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  await page.goto("/admin/events/new");
  await page.fill('input[name="title"]', "Glow in the Dark");
  await page.fill('input[name="startsAt"]', "2099-05-05T20:00");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/\d+$/);
  const tag = await page.locator("code", { hasText: "/c/event." }).innerText();

  const student = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await login(student, "student@demo.school");
  await student.goto("/scan");
  await student.getByPlaceholder("Or paste a code").fill(tag.trim());
  await student.getByRole("button", { name: "Go" }).click();
  const msg = student.getByRole("status");
  await expect(msg).toContainText("“Glow in the Dark” isn't open yet");
  await expect(msg).toContainText("one hour before it starts");
  await expect(msg).toContainText("2099");
  await student.screenshot({ path: `${SHOTS}/scan-closed.png` });
});
