import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrImage({ text, size = 256 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { width: size, margin: 1 }).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt="QR code" /> : <div style={{ width: size, height: size }} />;
}
