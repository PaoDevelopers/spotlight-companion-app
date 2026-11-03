import { test, expect } from "@playwright/test";
import { SHOTS, hideDevOverlay, login } from "./helpers";

// The exhibit list, editor, QR sign and delete exist in the Go server's web app only.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("teacher manages exhibits: list, editor with live preview, duplicate titles, Chinese titles, QR sign, visits, delete", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");

  // the list has the demo exhibits and a New exhibit button, like the event list
  await page.goto("/admin/exhibits");
  await expect(page.getByRole("link", { name: /Double Pendulum/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "New exhibit", exact: true })).toBeVisible();

  // new exhibit: the preview card follows what is typed; a cover picture and chemistry
  await page.getByRole("link", { name: "New exhibit", exact: true }).click();
  await expect(page.getByRole("article", { name: "Preview" }).getByText("Untitled exhibit")).toBeVisible();
  await page.fill('input[name="title"]', "Colour Wheel");
  await page.getByRole("button", { name: "Chemistry" }).click();
  await page.fill('input[name="summary"]', "Mixing light");
  await page.getByRole("button", { name: "Start from the usual headings" }).click();
  await page.locator('input[aria-label="Choose a cover picture"]').setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG });
  const preview = page.getByRole("article", { name: "Preview" });
  await expect(preview.getByText("Colour Wheel")).toBeVisible();
  await expect(preview.getByText("Chemistry")).toBeVisible();
  await expect(preview.getByRole("heading", { name: "How it works" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/exhibit-editor.png`, fullPage: true });
  await page.getByRole("button", { name: "Create exhibit" }).click();
  await expect(page).toHaveURL(/\/admin\/exhibits\/\d+$/);
  const firstUrl = page.url();
  await expect(page.getByRole("heading", { name: "Colour Wheel" })).toBeVisible();
  await expect(page.locator("code", { hasText: "/c/exhibit." })).toBeVisible();
  await expect(page.getByText("0", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/exhibit-detail.png`, fullPage: true });

  // a second exhibit with the same title is a new exhibit, not an overwrite
  await page.goto("/admin/exhibits/new");
  await page.fill('input[name="title"]', "Colour Wheel");
  await page.fill('input[name="summary"]', "The other one");
  await page.getByRole("button", { name: "Create exhibit" }).click();
  await expect(page).toHaveURL(/\/admin\/exhibits\/\d+$/);
  expect(page.url()).not.toBe(firstUrl);
  await page.goto("/admin/exhibits");
  await expect(page.getByRole("link", { name: /Colour Wheel/ })).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/exhibit-list.png`, fullPage: true });

  // a Chinese-only title works
  await page.goto("/admin/exhibits/new");
  await page.fill('input[name="title"]', "光的折射");
  await page.getByRole("button", { name: "Create exhibit" }).click();
  await expect(page).toHaveURL(/\/admin\/exhibits\/\d+$/);
  await expect(page.getByRole("heading", { name: "光的折射" })).toBeVisible();

  // edit the first one: the tag stays the same, the content changes, and students see it
  await page.goto(firstUrl);
  const tag = await page.locator("code", { hasText: "/c/exhibit." }).innerText();
  await page.getByRole("link", { name: "Edit exhibit" }).click();
  await expect(page.locator('input[name="title"]')).toHaveValue("Colour Wheel");
  await page.fill('input[name="title"]', "Colour Wheel (updated)");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();
  await page.getByRole("link", { name: "Back to the exhibit" }).click();
  await expect(page).toHaveURL(firstUrl);
  await expect(page.getByRole("heading", { name: "Colour Wheel (updated)" })).toBeVisible();
  expect(await page.locator("code", { hasText: "/c/exhibit." }).innerText()).toBe(tag);

  // the printable sign
  await page.getByRole("link", { name: "Print QR sign" }).click();
  await expect(page.getByRole("heading", { name: "Colour Wheel (updated)" })).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code" })).toBeVisible();
  await expect(page.getByText("Scan to learn about this exhibit")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/exhibit-sign.png`, fullPage: true });

  // a student scans the tag: the visit is counted for the teacher, and the student sees the page
  const student = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await login(student, "student@demo.school");
  const r = await student.request.post("/api/scan", { data: { code: tag.trim() } });
  expect((await r.json()).ok).toBe(true);
  await page.goto(firstUrl);
  await expect(page.getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("student has scanned this exhibit")).toBeVisible();
  await student.goto("/exhibits");
  await expect(student.getByText("Colour Wheel (updated)")).toBeVisible();
  await expect(student.getByText("Mixing light")).toBeVisible();

  // delete it from the detail page
  await page.getByRole("button", { name: "Delete exhibit" }).click();
  await expect(page).toHaveURL(/\/admin\/exhibits$/);
  await expect(page.getByRole("link", { name: /Colour Wheel \(updated\)/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
