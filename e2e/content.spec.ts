import { test, expect } from "@playwright/test";
import { SHOTS, hideDevOverlay, login } from "./helpers";

// Pictures in descriptions, chemistry, deleting records and the Back button exist in the Go server only.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

// a 1x1 PNG; the editor sends it as is because it is already small
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("teacher adds pictures to an event and an exhibit, uses chemistry, deletes records; students see them", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept()); // delete confirmations
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");

  // competitions are set up on the event itself, and the results page says so
  await page.goto("/admin/competitions");
  await expect(page.getByText(/tick This event is a competition/)).toBeVisible();

  // an event with chemistry and two pictures inside the description
  await page.goto("/admin/events/new");
  await page.fill('input[name="title"]', "Colour Chemistry");
  await page.getByRole("button", { name: "Chemistry" }).click();
  await page.fill('input[name="startsAt"]', "2099-04-01T15:00");
  await page.fill('textarea[name="description"]', "## Bring goggles\n");
  await page.locator('input[aria-label="Choose pictures"]').setInputFiles([
    { name: "flask one.png", mimeType: "image/png", buffer: PNG },
    { name: "flask-two.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.locator('textarea[name="description"]')).toHaveValue(/!\[flask one\]\(\/api\/images\/\d+\)[\s\S]*!\[flask-two\]\(\/api\/images\/\d+\)/);
  await page.locator('input[aria-label="Choose a cover picture"]').setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByAltText("Cover preview")).toBeVisible();
  await expect(page.getByRole("article", { name: "Preview" }).locator("img")).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/event-editor-pictures.png`, fullPage: true });
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/\d+$/);
  const eventId = page.url().split("/").pop();

  // a student sees the chemistry badge, the filter chip and the pictures actually loading
  const student = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await login(student, "student@demo.school");
  await student.goto("/events?subject=chemistry");
  await expect(student.getByText("Colour Chemistry")).toBeVisible();
  await student.getByText("Colour Chemistry").click();
  await expect(student.locator("article img").first()).toBeVisible();
  const loaded = await student.locator("article img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth));
  expect(loaded.length).toBe(3);
  expect(loaded.every((w) => w > 0)).toBe(true);

  // Back goes to the page they came from; with no history it goes up a level
  await expect(student.getByRole("button", { name: /Back/ })).toBeVisible();
  await student.getByRole("button", { name: /Back/ }).click();
  await expect(student).toHaveURL(/\/events\?subject=chemistry/);
  await student.goto(`/events/${eventId}`); // fresh load: no history to return to
  await student.getByRole("button", { name: /Back/ }).click();
  await expect(student).toHaveURL(/\/events$/);
  await expect(student.getByRole("button", { name: /Back/ })).toBeVisible();

  // an exhibit with a picture in its text, then delete it
  await page.goto("/admin/exhibits");
  await page.fill('input[name="title"]', "Wrong Exhibit");
  await page.locator('input[aria-label="Choose pictures"]').setInputFiles({ name: "x.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator('textarea[name="bodyMd"]')).toHaveValue(/!\[x\]\(\/api\/images\/\d+\)/);
  await page.getByRole("button", { name: "Save exhibit" }).click();
  const card = page.locator("div", { hasText: /^Wrong Exhibit/ }).last();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Wrong Exhibit")).toHaveCount(0);

  // delete the event from its edit page
  await page.goto(`/admin/events/${eventId}/edit`);
  await page.getByRole("button", { name: "Delete this event" }).click();
  await expect(page).toHaveURL(/\/admin\/events$/);
  await expect(page.getByRole("link", { name: /Colour Chemistry/ })).toHaveCount(0);

  // the teacher portal has Back too (a freshly opened page goes up one level)
  await page.goto("/admin/events/new");
  await page.getByRole("button", { name: /Back/ }).click();
  await expect(page).toHaveURL(/\/admin\/events$/);
  expect(errors).toEqual([]);
});
