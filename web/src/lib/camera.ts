/**
 * Opens a camera for scanning QR codes. It asks for the back camera. If the browser hands back the front camera anyway
 * and the device has another camera, it switches to the one that looks like the back camera. A device with a single
 * camera (a laptop) just uses it, because there is nothing better to choose.
 */

const BACK = /back|rear|environment|world|后置|后面|背面/i;
const FRONT = /front|user|face|selfie|前置|前面/i;

/** Picks the back camera among the video inputs, or undefined when none of them can be told apart. */
export function pickBackCamera(cams: Pick<MediaDeviceInfo, "deviceId" | "label">[]): string | undefined {
  const back = cams.filter((c) => BACK.test(c.label) && !FRONT.test(c.label));
  if (back.length > 0) return back[0].deviceId;
  // no label says "back" (labels are empty until camera permission is granted): use the one that is not marked front
  const notFront = cams.filter((c) => !FRONT.test(c.label));
  return notFront.length === 1 && cams.length > 1 ? notFront[0].deviceId : undefined;
}

export async function openBackCamera(): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  let stream = await md.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  const track = stream.getVideoTracks()[0];
  const facing = track?.getSettings().facingMode;
  if (facing === "environment") return stream;
  try {
    const cams = (await md.enumerateDevices()).filter((d) => d.kind === "videoinput");
    if (cams.length < 2) return stream; // only one camera: nothing to choose
    const id = pickBackCamera(cams);
    if (!id || id === track?.getSettings().deviceId) return stream;
    const better = await md.getUserMedia({ video: { deviceId: { exact: id } }, audio: false });
    stream.getTracks().forEach((t) => t.stop());
    stream = better;
  } catch {
    // keep what we have: a working camera is better than none
  }
  return stream;
}
