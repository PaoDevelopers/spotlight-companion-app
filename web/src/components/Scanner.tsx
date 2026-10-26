import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/** Camera QR scanner. Calls onScan once per distinct code. */
export function Scanner({ onScan }: { onScan: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onScan);
  handler.current = onScan;
  const [err, setErr] = useState("");

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let last = "";
    let stopped = false;
    const canvas = document.createElement("canvas");
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height);
            if (code?.data && code.data !== last) {
              last = code.data;
              handler.current(code.data);
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setErr("Camera unavailable. Allow camera access, or tap your NFC tag instead.");
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return err ? (
    <p role="alert" className="rounded bg-amber-100 p-3">
      {err}
    </p>
  ) : (
    <video ref={video} playsInline muted className="aspect-square w-full rounded-lg bg-black object-cover" />
  );
}
