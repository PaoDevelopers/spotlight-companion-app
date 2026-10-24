import { test, expect } from "@playwright/test";

const signInAs = async (page: import("@playwright/test").Page, who: string, from = "/login") => {
  await page.goto(from);
  await page.getByRole("link", { name: "Sign in with Microsoft" }).click();
  await page.locator(`#pick-${who}`).click();
};

test("login page offers Microsoft only", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Sign in with Microsoft" })).toBeVisible();
  await expect(page.locator('input[name="code"]')).toHaveCount(0);
});

test("student signs in, is created as a student, and cannot open the teacher portal", async ({ page }) => {
  await signInAs(page, "student");
  await expect(page.getByRole("heading", { name: "Hi Student" })).toBeVisible({ timeout: 60_000 });
  await page.goto("/admin");
  await expect(page).toHaveURL("http://localhost:3102/");
});

test("a deep link survives the Microsoft round trip", async ({ page }) => {
  await page.goto("/events");
  await expect(page).toHaveURL(/\/login\?next=%2Fevents/);
  await page.getByRole("link", { name: "Sign in with Microsoft" }).click();
  await page.locator("#pick-student").click();
  await expect(page).toHaveURL("http://localhost:3102/events");
});

test("staff address becomes a teacher and reaches the portal", async ({ page }) => {
  await signInAs(page, "teacher");
  await page.goto("/admin");
  await expect(page.getByText("Check-ins")).toBeVisible();
  await expect(page.getByText("Set a user's role")).toHaveCount(0); // teachers aren't admins
  await expect(page.getByRole("link", { name: "Roster" })).toHaveCount(0); // codes aren't used with Microsoft
});

test("ADMIN_EMAILS address becomes an admin", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/admin");
  await expect(page.getByText("Set a user's role")).toBeVisible();
});

test("non-school accounts, tokens for other apps, and mismatched sign-ins are refused", async ({ page }) => {
  for (const [who, message] of [
    ["outsider", "Please sign in with a school account."],
    ["otherapp", "could not be verified"],
    ["badnonce", "did not match the one that started"],
  ] as const) {
    await signInAs(page, who);
    await expect(page.getByRole("alert")).toContainText(message);
    await page.goto("/events");
    await expect(page).toHaveURL(/\/login/); // no session was created
  }
});

test("a replayed token without its nonce cookie is refused", async ({ request }) => {
  const res = await request.post("/auth", { form: { id_token: "x.y.z", state: "abc.L2V2ZW50cw" }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toContain("/login?error=expired");
  expect(res.headers()["set-cookie"] ?? "").not.toContain("session=");
});
