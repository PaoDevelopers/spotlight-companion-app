import { test, expect, type Page } from "@playwright/test";
import { hideDevOverlay, login } from "./helpers";

// Which camera the scanner uses. Go server's web app only.
test.skip(process.env.E2E_BACKEND !== "go", "Go server only");

type Cam = { deviceId: string; label: string };
const FRONT: Cam = { deviceId: "front1", label: "Front Camera" };
const BACK: Cam = { deviceId: "back1", label: "Back Camera" };

/** Fakes the camera API: `first` is the camera the browser hands out when asked for the back camera. */
async function fakeCameras(page: Page, cams: Cam[], first: "user" | "environment") {
  await page.addInitScript(
    ({ cams, first }) => {
      const calls: string[] = [];
      (window as unknown as { __calls: string[] }).__calls = calls;
      const stream = (facing: string, id: string) => {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        c.getContext("2d")!.fillRect(0, 0, 64, 64);
        const s = c.captureStream(5);
        s.getVideoTracks()[0].getSettings = () => ({ facingMode: facing, deviceId: id }) as MediaTrackSettings;
        return s;
      };
      navigator.mediaDevices.enumerateDevices = async () => cams.map((c) => ({ ...c, kind: "videoinput", groupId: "", toJSON() {} }) as MediaDeviceInfo);
      navigator.mediaDevices.getUserMedia = async (c) => {
        const v = c?.video as MediaTrackConstraints;
        calls.push(JSON.stringify(v));
        const exact = (v.deviceId as ConstrainDOMStringParameters | undefined)?.exact as string | undefined;
        if (exact) return stream(exact === "back1" ? "environment" : "user", exact);
        return first === "environment" ? stream("environment", "back1") : stream("user", "front1");
      };
    },
    { cams, first },
  );
}

async function openScanner(page: Page) {
  await hideDevOverlay(page);
  await login(page, "student@demo.school");
  await page.goto("/scan");
  await expect(page.locator("video")).toBeVisible();
  await page.waitForTimeout(300);
  return page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
}

test("asks for the back camera first, and is happy when it gets it", async ({ page }) => {
  await fakeCameras(page, [FRONT, BACK], "environment");
  const calls = await openScanner(page);
  expect(calls).toEqual(['{"facingMode":{"ideal":"environment"}}']);
});

test("a device with two cameras that hands out the front one is switched to the back one", async ({ page }) => {
  await fakeCameras(page, [FRONT, BACK], "user");
  const calls = await openScanner(page);
  expect(calls).toEqual(['{"facingMode":{"ideal":"environment"}}', '{"deviceId":{"exact":"back1"}}']);
});

test("a device with one camera (a laptop) just uses it", async ({ page }) => {
  await fakeCameras(page, [FRONT], "user");
  const calls = await openScanner(page);
  expect(calls).toEqual(['{"facingMode":{"ideal":"environment"}}']);
  await expect(page.locator("video")).toBeVisible();
});

test("two cameras that cannot be told apart: keep what the browser chose instead of guessing", async ({ page }) => {
  await fakeCameras(page, [{ deviceId: "a", label: "" }, { deviceId: "b", label: "" }], "user");
  const calls = await openScanner(page);
  expect(calls).toHaveLength(1);
});
