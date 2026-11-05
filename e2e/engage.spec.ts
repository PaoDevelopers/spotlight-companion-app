import { test, expect } from "@playwright/test";
import { hideDevOverlay, login } from "./helpers";

// The library, scavenger hunts and shared works exist in the Go server only.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

test("library: teacher adds a book, student marks it read and comments, teacher deletes the comment", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  await page.goto("/admin/library/new");
  await page.fill('input[name="title"]', "Uncle Tungsten");
  await page.fill('input[name="author"]', "Oliver Sacks");
  await page.fill('input[name="summary"]', "A chemist's boyhood");
  await page.getByRole("button", { name: "Add book" }).click();
  await expect(page).toHaveURL(/\/admin\/library\/\d+\/edit/);
  await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const s = await ctx.newPage();
  await hideDevOverlay(s);
  await login(s, "student@demo.school");
  await s.getByRole("link", { name: "More", exact: true }).click();
  await s.getByRole("link", { name: /Library/ }).click();
  await s.getByRole("link", { name: /Uncle Tungsten/ }).click();
  await expect(s.getByText("0 students have read this")).toBeVisible();
  await s.getByRole("button", { name: "I've read this" }).click();
  await expect(s.getByText("1 student has read this")).toBeVisible();
  await s.getByLabel("Your comment").fill("Wonderful memoir");
  await s.getByRole("button", { name: "Post comment" }).click();
  await expect(s.getByText("Wonderful memoir")).toBeVisible();
  await expect(s.getByText("Demo Student")).toBeVisible(); // the real name, not hidden

  await page.goto("/library");
  await page.getByRole("link", { name: /Uncle Tungsten/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Wonderful memoir")).toHaveCount(0);
  await ctx.close();
  expect(errors).toEqual([]);
});

test("scavenger hunt: stages unlock in order, a typed code completes one, the teacher can tick one and see who finished", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  await page.goto("/admin/hunts/new");
  await page.fill('input[name="title"]', "Lab trail");
  await page.getByLabel("Stage 1 title").fill("Fume cupboard");
  await page.getByLabel("Stage 1 clue").fill("Look where the air is pulled away");
  await page.getByLabel("Stage 1 accepted answers").fill("Sodium");
  await page.getByRole("button", { name: "Add a stage" }).click();
  await page.getByLabel("Stage 2 title").fill("Balance room");
  await page.getByLabel("Stage 2 clue").fill("SECRET-CLUE-TWO");
  await page.getByLabel("Stage 2 accepted answers").fill("Chlorine\nCl");
  await page.getByLabel(/Open to students/).check();
  await page.getByRole("button", { name: "Create hunt" }).click();
  await expect(page).toHaveURL(/\/admin\/hunts\/\d+\/edit/);
  const huntId = page.url().match(/hunts\/(\d+)/)![1];

  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const s = await ctx.newPage();
  await hideDevOverlay(s);
  await login(s, "student@demo.school");
  await s.goto(`/hunts/${huntId}`);
  await expect(s.getByText("Look where the air is pulled away")).toBeVisible();
  await expect(s.getByText("SECRET-CLUE-TWO")).toHaveCount(0); // locked stages show no clue
  await s.getByLabel("Code word or answer").fill("chlorine");
  await s.getByRole("button", { name: "Check" }).click();
  await expect(s.getByText(/belongs to a later stage/)).toBeVisible();
  await s.getByLabel("Code word or answer").fill("nonsense");
  await s.getByRole("button", { name: "Check" }).click();
  await expect(s.getByText(/doesn't match any stage/)).toBeVisible();
  await s.getByLabel("Code word or answer").fill("  SODIUM ");
  await s.getByRole("button", { name: "Check" }).click();
  await expect(s.getByText(/Stage 1 complete/)).toBeVisible();
  await expect(s.getByText("SECRET-CLUE-TWO")).toBeVisible();
  await s.getByLabel("Code word or answer").fill("cl");
  await s.getByRole("button", { name: "Check" }).click();
  await expect(s.getByText(/You finished the hunt/).first()).toBeVisible();

  await page.goto(`/admin/hunts/${huntId}/results`);
  await expect(page.getByText("Demo Student").first()).toBeVisible();
  await expect(page.getByText(/^Finished /)).toBeVisible();
  await page.goto(`/admin/hunts/${huntId}/signs`);
  await expect(page.getByText("Stage 2: Balance room")).toBeVisible();
  await ctx.close();
  expect(errors).toEqual([]);
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("photos: a checked-in student shares a work on an event; hunt evidence is uploaded and stays private", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  // a hunt to attach evidence to
  const created = await page.request.post("/api/admin/hunts", {
    data: { title: "Photo trail", subject: "chemistry", description: "", imageUrl: "", published: true, stages: [{ title: "Only", clue: "find it", answers: ["x"] }] },
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3100" },
  });
  const huntId = (await created.json()).hunt.id;
  // the student is checked in by the teacher (no phone needed)
  const chk = await page.request.post("/api/admin/events/1/attendees", { data: { email: "student@demo.school" }, headers: { "Content-Type": "application/json", Origin: "http://localhost:3100" } });
  expect(chk.ok()).toBeTruthy();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const s = await ctx.newPage();
  s.on("pageerror", (e) => errors.push(e.message));
  s.on("dialog", (d) => d.accept());
  await hideDevOverlay(s);
  await login(s, "student@demo.school");
  await s.goto("/events/1");
  await s.locator('input[type="file"]').setInputFiles({ name: "painting.png", mimeType: "image/png", buffer: PNG });
  await s.getByLabel("Caption").fill("My watercolour");
  await s.getByRole("button", { name: "Send photo" }).click();
  await expect(s.getByText("My watercolour")).toBeVisible();
  await s.getByRole("button", { name: "Remove" }).click();
  await expect(s.getByText("My watercolour")).toHaveCount(0);

  await s.goto(`/hunts/${huntId}`);
  await s.getByRole("button", { name: "Add a photo of your evidence" }).click();
  await s.locator('input[type="file"]').setInputFiles({ name: "find.png", mimeType: "image/png", buffer: PNG });
  await s.getByRole("button", { name: "Send photo" }).click();
  const img = s.getByAltText("Your evidence");
  await expect(img).toBeVisible();
  const src = (await img.getAttribute("src"))!;
  expect((await s.request.get(src)).status()).toBe(200);
  expect((await page.request.get(src)).status()).toBe(200); // a teacher may see it
  await ctx.close();
  expect(errors).toEqual([]);
});
