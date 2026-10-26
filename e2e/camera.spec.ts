import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { makePassToken, makeTagToken } from "../lib/checkin/token";
import { hideDevOverlay, login } from "./helpers";
import { ORIGIN, SECRET, tokenPath } from "./env";


/** Launches Chromium whose "camera" is a looping video of the given QR text. */
async function browserWithCamera(text: string): Promise<Browser> {
  const dir = mkdtempSync(join(tmpdir(), "qrcam-"));
  const png = join(dir, "qr.png"), y4m = join(dir, "qr.y4m");
  writeFileSync(png, await QRCode.toBuffer(text, { width: 480, margin: 4 }));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", "3", "-pix_fmt", "yuv420p", "-r", "10",
    "-vf", "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:white", y4m]);
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`],
  });
}

/** Decodes the QR image currently rendered on the page with jsQR. */
async function decodeQrOnPage(page: Page): Promise<string> {
  await page.addScriptTag({ path: "node_modules/jsqr/dist/jsQR.js" });
  return page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('img[alt="QR code"]')!;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).jsQR(d.data, d.width, d.height)?.data ?? "";
  });
}

test("student scanner decodes an event QR and an exhibit QR from the camera", async ({ page }) => {
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  const { token } = await (await page.request.get(tokenPath(1))).json();

  // Event QR (what the projector shows)
  let cam = await browserWithCamera(`${ORIGIN}/c/${token}`);
  let ctx = await cam.newContext({ viewport: { width: 390, height: 844 } });
  let p = await ctx.newPage();
  await hideDevOverlay(p);
  await login(p, "student@demo.school");
  await p.goto("/scan");
  await expect(p.locator("video")).toBeVisible();
  await expect(p.getByRole("status")).toContainText(/(Checked in|Already checked in) to Opening Assembly/, { timeout: 30_000 });
  await cam.close();

  // Exhibit tag QR: scanning records a visit and jumps to the exhibit page
  cam = await browserWithCamera(`${ORIGIN}/c/${makeTagToken(SECRET, "exhibit", 1)}`);
  ctx = await cam.newContext({ viewport: { width: 390, height: 844 } });
  p = await ctx.newPage();
  await hideDevOverlay(p);
  await login(p, "student@demo.school");
  await p.goto("/scan");
  await expect(p).toHaveURL(/\/exhibits\/double-pendulum/, { timeout: 30_000 });
  await p.goto("/exhibits");
  await expect(p.getByText("✅ Double Pendulum")).toBeVisible();
  await cam.close();

  // An expired/forged QR is rejected with a clear message
  cam = await browserWithCamera(`${ORIGIN}/c/1.1.forged`);
  ctx = await cam.newContext();
  p = await ctx.newPage();
  await hideDevOverlay(p);
  await login(p, "student@demo.school");
  await p.goto("/scan");
  await expect(p.getByRole("status")).toContainText("invalid or expired", { timeout: 30_000 });
  await cam.close();
});

test("teacher scans a student's pass QR", async () => {
  const cam = await browserWithCamera(makePassToken(SECRET, 2)); // seeded student is user 2
  const ctx = await cam.newContext();
  const p = await ctx.newPage();
  await hideDevOverlay(p);
  await login(p, "teacher@demo.school");
  await p.goto("/admin/events/1/scan");
  await expect(p.getByRole("status").or(p.locator("li").filter({ hasText: /Demo Student/ })).first()).toBeVisible({ timeout: 30_000 });
  await expect(p.locator("ul[aria-live] li").first()).toContainText(/Demo Student (was already )?checked in/);
  await cam.close();
});

test("projector page shows a valid QR that rotates", async ({ page }) => {
  await hideDevOverlay(page);
  await login(page, "teacher@demo.school");
  await page.goto("/admin/events/1/display");
  await expect(page.getByRole("img", { name: "QR code" })).toBeVisible();
  const first = await decodeQrOnPage(page);
  expect(first).toMatch(new RegExp(`^${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/c/1\\.\\d+\\.[\\w-]+$`));

  // Same URL a phone camera would open must actually check a student in
  const student = await (await page.context().browser()!.newContext()).newPage();
  await login(student, "student@demo.school");
  await student.goto(first.replace(ORIGIN, ""));
  await expect(student.getByRole("status")).toContainText(/Checked in|Already checked in/);

  // The code changes when the 30s window rolls over
  // (a decode can fail mid-swap while React replaces the image; treat that as "not changed yet")
  const safeDecode = () => decodeQrOnPage(page).catch(() => first);
  await expect.poll(safeDecode, { timeout: 50_000, intervals: [3000] }).not.toBe(first);
  expect(await safeDecode()).toMatch(/\/c\/1\.\d+\.[\w-]+$/);
});
