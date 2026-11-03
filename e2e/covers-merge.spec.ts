import { test, expect, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { SHOTS, hideDevOverlay, login } from "./helpers";

// Cover pictures in lists, "Back goes to the parent page", and merging a student's two accounts: Go server's web app only.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");
test.use({ viewport: { width: 1280, height: 900 } });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function upload(page: Page): Promise<string> {
  const r = await page.request.post("/api/admin/images", { data: PNG, headers: { "Content-Type": "application/octet-stream" } });
  return (await r.json()).url as string;
}

test("lists show the cover, else the first picture in the text, else nothing; Back goes to the parent page", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  const coverUrl = await upload(page);
  const bodyUrl = await upload(page);
  const when = { startsAt: "2099-09-01T10:00:00Z", endsAt: "2099-09-01T11:00:00Z", subject: "cs" };
  await page.request.post("/api/admin/events", { data: { ...when, title: "Has Cover", imageUrl: coverUrl, description: `Text ![first](${bodyUrl})` } });
  await page.request.post("/api/admin/events", { data: { ...when, title: "Body Picture Only", description: `Intro\n\n![shot](${bodyUrl})\n\nmore ![second](${coverUrl})` } });
  await page.request.post("/api/admin/events", { data: { ...when, title: "No Pictures", description: "Just words" } });
  await page.request.post("/api/admin/events", { data: { ...when, title: "Unsafe Picture", description: "![x](javascript:alert(1)) and ![y](http://insecure.example/a.png)" } });
  await page.request.post("/api/admin/exhibits", { data: { title: "Exhibit With Cover", subject: "cs", imageUrl: coverUrl, bodyMd: `![a](${bodyUrl})` } });
  await page.request.post("/api/admin/exhibits", { data: { title: "Exhibit Body Picture", subject: "cs", bodyMd: `Words\n![a](${bodyUrl})` } });
  await page.request.post("/api/admin/exhibits", { data: { title: "Exhibit Plain", subject: "cs", bodyMd: "Words only" } });

  const srcOf = (p: Page, title: string) => p.getByRole("link", { name: new RegExp(title) }).locator("img").evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src")));

  // the same rule in the student's lists and the teacher's lists
  const student = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await login(student, "student@demo.school");
  for (const [who, eventsUrl, exhibitsUrl] of [[student, "/events", "/exhibits"], [page, "/admin/events", "/admin/exhibits"]] as const) {
    await who.goto(eventsUrl);
    await expect(who.getByRole("link", { name: /Has Cover/ })).toBeVisible();
    expect(await srcOf(who, "Has Cover")).toEqual([coverUrl]);
    expect(await srcOf(who, "Body Picture Only")).toEqual([bodyUrl]);
    expect(await srcOf(who, "No Pictures")).toEqual([]); // no placeholder at all
    expect(await srcOf(who, "Unsafe Picture")).toEqual([]); // never a script or an insecure address
    await who.goto(exhibitsUrl);
    await expect(who.getByRole("link", { name: /Exhibit With Cover/ })).toBeVisible();
    expect(await srcOf(who, "Exhibit With Cover")).toEqual([coverUrl]);
    expect(await srcOf(who, "Exhibit Body Picture")).toEqual([bodyUrl]);
    expect(await srcOf(who, "Exhibit Plain")).toEqual([]);
  }
  // the pictures really load
  await student.goto("/events");
  const loaded = await student.getByRole("link", { name: /Has Cover/ }).locator("img").evaluate((i) => (i as HTMLImageElement).naturalWidth);
  expect(loaded).toBeGreaterThan(0);
  await student.screenshot({ path: `${SHOTS}/events-with-covers.png`, fullPage: true });

  // Back goes to the parent page, named, however the page was reached
  await page.goto("/admin/events");
  await page.getByRole("link", { name: /Has Cover/ }).click();
  await expect(page.getByRole("button", { name: "Back to Events" })).toBeVisible();
  await page.getByRole("link", { name: "Edit event" }).click();
  await page.getByRole("button", { name: "Back to the event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/\d+$/);
  await page.getByRole("button", { name: "Back to Events" }).click();
  await expect(page).toHaveURL(/\/admin\/events$/);
  await page.getByRole("button", { name: "Back to the Teacher portal" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  // it is the parent, not the history: arrive on an exhibit's QR sign from the dashboard, Back still names the exhibit
  await page.goto("/admin/exhibits");
  await page.getByRole("link", { name: /Exhibit Plain/ }).click();
  const exhibitUrl = page.url();
  await page.getByRole("link", { name: "Print QR sign" }).click();
  await page.goto("/admin"); // wander off
  await page.goBack();
  await page.getByRole("button", { name: "Back to the exhibit" }).click();
  await expect(page).toHaveURL(exhibitUrl);
  expect(errors).toEqual([]);
});

test("an admin merges a student's two accounts: history moves, the real name stays", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  // two accounts for one person: the record (with a check-in) and the account they signed in with
  await page.request.post("/api/admin/roster", { data: { csv: "name,email,class\nOld Record Pat,s91111@stu.ykpaoschool.cn,9A\nPat Real Account,pat.real@stu.ykpaoschool.cn,\n" } });
  const events = await (await page.request.get("/api/admin/events")).json();
  const eventId = events[0].id as number;
  const find = async (q: string) => (await (await page.request.get(`/api/admin/students?q=${encodeURIComponent(q)}`)).json())[0] as { id: number };
  const oldRec = await find("Old Record Pat"), real = await find("Pat Real Account");
  await page.request.post(`/api/admin/events/${eventId}/attendees`, { data: { userId: oldRec.id } });

  // an admin for the test
  const r = await page.request.post("/api/admin/roster", { data: { csv: "name,email,class\nMerge Admin,merge.admin@ykpaoschool.cn,\n" } });
  const code = (await r.json()).issued[0].code as string;
  const db = new DatabaseSync(process.env.E2E_DB!);
  db.prepare("UPDATE users SET role = 'admin' WHERE email = 'merge.admin@ykpaoschool.cn'").run();
  db.close();
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill('input[name="email"]', "merge.admin@ykpaoschool.cn");
  await page.fill('input[name="code"]', code);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));

  await page.goto("/admin");
  const panel = page.locator("section", { hasText: "Merge a student's two accounts" });
  await panel.getByLabel("The real account (the one they sign in with)").fill("Pat Real");
  await panel.getByRole("list", { name: /The real account.*results/ }).getByRole("button", { name: "Choose" }).first().click();
  await panel.getByLabel("The old record to replace").fill("Old Record");
  await panel.getByRole("list", { name: /The old record.*results/ }).getByRole("button", { name: "Choose" }).first().click();
  const summary = panel.getByRole("status");
  await expect(summary).toContainText("Old Record Pat");
  await expect(summary).toContainText("Pat Real Account");
  await expect(summary).toContainText("1 check-in");
  await expect(summary).toContainText("cannot be undone");
  await page.screenshot({ path: `${SHOTS}/merge-accounts.png`, fullPage: true });
  await panel.getByRole("button", { name: "Merge these two accounts" }).click();
  await expect(panel.getByText("Merged.")).toBeVisible();

  // the old record is gone, its check-in is on the real account, and its address leads to the real one
  const left = (await (await page.request.get("/api/admin/students?q=Old Record")).json()) as unknown[];
  expect(left.length).toBe(0);
  const detail = await (await page.request.get(`/api/admin/events/${eventId}`)).json();
  expect(detail.attendees.map((a: { userId: number }) => a.userId)).toContain(real.id);
  const byAddress = (await (await page.request.get("/api/admin/students?q=s91111")).json()) as { id: number }[];
  expect(byAddress.length === 0 || byAddress[0].id === real.id).toBe(true);
  expect(errors).toEqual([]);
});
