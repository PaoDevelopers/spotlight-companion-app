import { test, expect } from "@playwright/test";
import { SHOTS, hideDevOverlay, login } from "./helpers";

// The competition results table exists in the Go server's web app only.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

test("results: columns with headings, one Save for many rows, ranks from scores, one bad row does not lose the rest", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");

  // an event that is a competition, with three students entered by the teacher
  await page.request.post("/api/admin/roster", { data: { csv: "name,email,class\nAnn Alpha,ann@demo.school,9A\nBob Beta,bob@demo.school,9B\nCy Gamma,cy@demo.school,9C" } });
  await page.goto("/admin/events/new");
  await page.fill('input[name="title"]', "Science Quiz");
  await page.fill('input[name="startsAt"]', "2099-08-01T10:00");
  await page.getByLabel("This event is a competition").check();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/\d+$/);
  const comps = (await (await page.request.get("/api/admin/competitions")).json()).competitions as { id: number; name: string }[];
  const cid = comps.find((c) => c.name === "Science Quiz")!.id;
  for (const who of ["Ann", "Bob", "Cy"]) {
    const hit = (await (await page.request.get(`/api/admin/students?q=${who}`)).json())[0];
    await page.request.post(`/api/admin/competitions/${cid}/entries`, { data: { userId: hit.id } });
  }

  await page.goto("/admin/competitions");
  const card = page.getByRole("region", { name: "Science Quiz" });
  // the columns are named, so a number in a box is never a mystery
  for (const h of ["Student", "Status", "Score", "Rank", "Notes"]) await expect(card.getByRole("columnheader", { name: h })).toBeVisible();
  await expect(card.getByRole("button", { name: "No changes to save" })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/results-table-empty.png`, fullPage: true });

  // type scores for everyone, then fill the ranks in one press
  await card.getByLabel("Score for Ann Alpha").fill("90");
  await card.getByLabel("Score for Bob Beta").fill("80");
  await card.getByLabel("Score for Cy Gamma").fill("80");
  await expect(card.getByText("3 rows have changes that are not saved yet")).toBeVisible();
  await expect(card.getByRole("row", { name: "Ann Alpha" }).getByText("edited")).toBeVisible();
  await card.getByRole("button", { name: "Fill ranks from scores" }).click();
  await expect(card.getByLabel("Rank for Ann Alpha")).toHaveValue("1");
  await expect(card.getByLabel("Rank for Bob Beta")).toHaveValue("2");
  await expect(card.getByLabel("Rank for Cy Gamma")).toHaveValue("2"); // equal scores share a rank
  await page.screenshot({ path: `${SHOTS}/results-table-edited.png`, fullPage: true });

  // leaving with unsaved rows asks; staying keeps the typing
  let asked = 0;
  page.once("dialog", (d) => { asked++; void d.dismiss(); }); // "stay on this page"
  await page.getByRole("navigation", { name: "Teacher portal" }).getByRole("link", { name: "Awards" }).click();
  expect(asked).toBe(1);
  await expect(card.getByLabel("Score for Ann Alpha")).toHaveValue("90");

  // one Save stores all three
  await card.getByRole("button", { name: "Save 3 changes" }).click();
  await expect(card.getByRole("button", { name: "✓ All saved" })).toBeDisabled();
  await expect(card.getByText("All changes are saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Science Quiz" }).getByLabel("Rank for Cy Gamma")).toHaveValue("2");

  // discard throws away typing
  const card2 = page.getByRole("region", { name: "Science Quiz" });
  await card2.getByLabel("Score for Ann Alpha").fill("5");
  await card2.getByRole("button", { name: "Discard changes" }).click();
  await expect(card2.getByLabel("Score for Ann Alpha")).toHaveValue("90");

  // a row the server refuses (rank 0) is reported, the good row is still saved, and the bad one stays marked
  await card2.getByLabel("Rank for Ann Alpha").fill("0");
  await card2.getByLabel("Notes for Bob Beta").fill("fast answers");
  await card2.getByRole("button", { name: "Save 2 changes" }).click();
  await expect(card2.getByRole("alert")).toContainText("1 of 2 could not be saved");
  await expect(card2.getByRole("row", { name: "Ann Alpha" }).getByText("edited")).toBeVisible();
  await expect(card2.getByRole("row", { name: "Bob Beta" }).getByText("edited")).toHaveCount(0);
  await expect(card2.getByLabel("Notes for Bob Beta")).toHaveValue("fast answers");
  // typing the saved value back means there is nothing left to save for that row
  await card2.getByLabel("Rank for Ann Alpha").fill("1");
  await expect(card2.getByRole("button", { name: "No changes to save" })).toBeDisabled();
  await card2.getByLabel("Rank for Ann Alpha").fill("3");
  await card2.getByRole("button", { name: "Save 1 change" }).click();
  await expect(card2.getByRole("button", { name: "✓ All saved" })).toBeVisible();
  await expect(card2.getByLabel("Rank for Ann Alpha")).toHaveValue("3");

  // students see the result on the Board
  const student = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await login(student, "student@demo.school");
  await student.goto("/leaderboard");
  await expect(student.getByText("Science Quiz")).toBeVisible();
  expect(errors).toEqual([]);

  // phone-size teacher: each student is a small card with its own labels
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await login(phone, "teacher@demo.school");
  await phone.goto("/admin/competitions");
  await expect(phone.getByRole("region", { name: "Science Quiz" }).getByLabel("Score for Ann Alpha")).toBeVisible();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await phone.screenshot({ path: `${SHOTS}/results-table-phone.png`, fullPage: true });
});
